# Your first project

Visualise AI shows architecture and work reported by agents. It does not inspect
your repository automatically or start an agent from the cockpit. An empty
project list means no agent or demo has reported a project to this instance yet.
You do not need to write events or learn the event contract to get started.

## Connect an agent

1. Keep this Visualise AI instance running. In your agent application's MCP server
   settings, add a server named **Visualise AI** using **Streamable HTTP**.
2. Use the address of the cockpit with `/mcp` appended. For the default local
   installation this is `http://localhost:8080/mcp`. If you opened the cockpit on
   another port, use that same port. A remote agent needs an address it can reach;
   its `localhost` refers to the agent's own machine. Keep the instance on your
   local machine or private network; it has no authentication.
3. Enable the server's tools in your agent application. An image-capable client
   can also inspect rendered architecture diagrams. Exact settings differ by
   client; see its MCP setup instructions if it has no server settings screen.
4. Ask your agent, in that application's conversation:

   > Use the Visualise AI tools to open a project and work context for this
   > repository. Report the architecture you can verify, then report your work
   > and relevant feedback as you proceed. Read the available tool descriptions
   > for their required inputs.

5. Return to the cockpit and reload the project list after the first report.
   Open the reported project, then select a component to inspect its work,
   feedback and code changes. Connecting the server alone does not create data;
   the agent must actually report a project.

For client configuration details and a runnable SDK example, continue with the
[MCP guide](mcp-domain-tools.md#client-configuration). No extra cockpit button
starts or controls the agent.

## Set up the demo

The demo is a fictional shop project with architecture, agents, feedback and
code changes. It lets you explore the cockpit without connecting an agent.

You need a checkout of this repository and Node 24 with npm on the machine that
will run the demo. If you still need the cockpit itself, first follow the
[Compose startup instructions](operations.md#starting-from-a-fresh-checkout).

From the repository directory, run:

```bash
cd simulator
npm ci
npm run simulate
```

The default destination is `http://localhost:8080`. For another cockpit address,
replace the last command with your actual address, for example:

```bash
npm run simulate -- --base http://localhost:8101
```

After the command completes, reload the cockpit's project list and open
**visualise-ai**. Select a component in the architecture to read its reports in
the inspector. These are sample reports, not observations of your repository.

For prerequisites, port conflicts and simulator options, see
[running the demo](operations.md#running-the-demo).
