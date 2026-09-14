package render

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path"
	"strings"

	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/fetch"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"
	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// Chromium uses an administrator-configured native entry, never a tool argument.
// Each call owns a fresh process/profile and only permits that entry and its
// same-origin build assets. Model descriptors enter through CDP values, not HTML.
type Chromium struct{ executable, entry string }

func NewChromium(executable, entry string) (*Chromium, error) {
	u, err := url.Parse(entry)
	if err != nil || u == nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Path != "/render.html" || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("RENDER_ENTRY_URL must be an absolute http(s) URL ending in /render.html without credentials, query or fragment")
	}
	return &Chromium{executable: executable, entry: entry}, nil
}
func (b *Chromium) allowed(raw string) bool {
	got, err := url.Parse(raw)
	if err != nil {
		return false
	}
	entry, _ := url.Parse(b.entry)
	return got.Scheme == entry.Scheme && got.Host == entry.Host && got.User == nil && got.RawQuery == "" && path.Clean(got.Path) == got.Path &&
		(got.Path == "/render.html" || strings.HasPrefix(got.Path, "/assets/"))
}
func (b *Chromium) Paint(ctx context.Context, snapshot store.ViewSnapshot, request Request) ([]byte, Painting, error) {
	options := append([]chromedp.ExecAllocatorOption{}, chromedp.DefaultExecAllocatorOptions[:]...)
	// Alpine Chromium's GPU process hits an unsupported seccomp syscall under
	// Docker. Keep the renderer sandbox; disable only the unused GPU sandbox.
	options = append(options, chromedp.ExecPath(b.executable), chromedp.Flag("disable-gpu-sandbox", true), chromedp.Flag("disable-dev-shm-usage", false), chromedp.Flag("hide-scrollbars", true), chromedp.Flag("force-color-profile", "srgb"), chromedp.Flag("lang", "en-US"))
	allocator, cancelAllocator := chromedp.NewExecAllocator(ctx, options...)
	defer cancelAllocator()
	browser, cancelBrowser := chromedp.NewContext(allocator)
	defer cancelBrowser()
	chromedp.ListenTarget(browser, func(event any) {
		if paused, ok := event.(*fetch.EventRequestPaused); ok {
			go func() {
				action := chromedp.ActionFunc(func(ctx context.Context) error {
					if b.allowed(paused.Request.URL) {
						return fetch.ContinueRequest(paused.RequestID).Do(ctx)
					}
					return fetch.FailRequest(paused.RequestID, network.ErrorReasonBlockedByClient).Do(ctx)
				})
				_ = chromedp.Run(browser, action)
			}()
		}
	})
	var painting Painting
	var png []byte
	// Separate allocation so launch/sandbox failures cannot be mistaken for
	// native frontend failures. chromedp includes Chromium's startup stderr.
	if err := chromedp.Run(browser); err != nil {
		return nil, Painting{}, fmt.Errorf("start Chromium: %w", err)
	}
	err := chromedp.Run(browser,
		renderStage("configure viewport and network", emulation.SetDeviceMetricsOverride(request.Viewport.Width, request.Viewport.Height, float64(request.Viewport.PixelRatio), false),
			fetch.Enable().WithPatterns([]*fetch.RequestPattern{{URLPattern: "*"}})),
		renderStage("navigate native entry", chromedp.Navigate(b.entry)),
		renderStage("wait for native entry", chromedp.Poll("typeof window.visualiseRender === 'function'", nil)),
		renderStage("paint captured snapshot", chromedp.ActionFunc(func(ctx context.Context) error {
			captured, err := json.Marshal(snapshot)
			if err != nil {
				return err
			}
			settings, err := json.Marshal(request)
			if err != nil {
				return err
			}
			global, exception, err := runtime.Evaluate("window").Do(ctx)
			if err != nil {
				return err
			}
			if exception != nil {
				return fmt.Errorf("native render entry unavailable")
			}
			result, exception, err := runtime.CallFunctionOn("function(snapshot, settings) { return window.visualiseRender(snapshot, settings); }").
				WithObjectID(global.ObjectID).
				WithArguments([]*runtime.CallArgument{{Value: captured}, {Value: settings}}).
				WithAwaitPromise(true).WithReturnByValue(true).Do(ctx)
			if err != nil {
				return err
			}
			if exception != nil {
				return fmt.Errorf("native render entry failed: %s", exception.Text)
			}
			return json.Unmarshal(result.Value, &painting)
		})),
		renderStage("capture PNG", chromedp.ActionFunc(func(ctx context.Context) error {
			var err error
			png, err = page.CaptureScreenshot().WithFormat(page.CaptureScreenshotFormatPng).WithCaptureBeyondViewport(false).WithFromSurface(true).Do(ctx)
			return err
		})),
	)
	return png, painting, err
}

func renderStage(name string, actions ...chromedp.Action) chromedp.Action {
	return chromedp.ActionFunc(func(ctx context.Context) error {
		if err := (chromedp.Tasks(actions)).Do(ctx); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		return nil
	})
}
