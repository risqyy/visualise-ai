package readapi

import (
	"context"
	"encoding/base64"
	"sort"
	"strconv"

	"github.com/risqyy/visualise-ai/backend/internal/store"
)

type ViewsResponse struct {
	store.ViewsSnapshot
	NextCursor *string `json:"nextCursor"`
}

func (s *Service) Views(ctx context.Context, projectID, rawLimit, rawCursor string) (ViewsResponse, error) {
	page, invalid := parsePage("limit", "cursor", rawLimit, rawCursor)
	if invalid != nil {
		return ViewsResponse{}, invalid
	}
	if len(rawCursor) > 2048 {
		return ViewsResponse{}, &store.DomainError{Code: "invalid_input", Field: "/cursor", Detail: "cursor exceeds 2048 characters"}
	}
	snapshot, err := store.New(s.db).ListViews(ctx, projectID)
	if err != nil {
		return ViewsResponse{}, err
	}
	last := ""
	if page.Cursor != "" {
		parts, err := decodeCursor(page.Cursor)
		if err != nil || len(parts) != 4 || parts[0] != "views" || parts[1] != projectID {
			return ViewsResponse{}, &store.DomainError{Code: "invalid_input", Field: "/cursor", Detail: "cursor belongs to another collection or project"}
		}
		if parts[2] != strconv.FormatInt(snapshot.ProjectPosition, 10) {
			return ViewsResponse{}, &store.DomainError{Code: "stale_cursor", Field: "/cursor", Detail: "view snapshot changed; restart pagination"}
		}
		decoded, err := base64.RawURLEncoding.DecodeString(parts[3])
		if err != nil {
			return ViewsResponse{}, &store.DomainError{Code: "invalid_input", Field: "/cursor", Detail: "invalid view cursor"}
		}
		last = string(decoded)
	}
	start := sort.Search(len(snapshot.Items), func(i int) bool { return snapshot.Items[i].ViewID > last })
	end := min(start+page.Limit, len(snapshot.Items))
	response := ViewsResponse{ViewsSnapshot: snapshot}
	response.Items = snapshot.Items[start:end]
	if end < len(snapshot.Items) {
		cursor := encodeCursor("views", projectID, strconv.FormatInt(snapshot.ProjectPosition, 10), base64.RawURLEncoding.EncodeToString([]byte(snapshot.Items[end-1].ViewID)))
		response.NextCursor = &cursor
	}
	return response, nil
}
func (s *Service) View(ctx context.Context, projectID, viewID string) (store.ViewResponse, error) {
	return store.New(s.db).ReadView(ctx, projectID, viewID)
}
