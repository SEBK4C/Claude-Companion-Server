// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import "vitest-axe/extend-expect";

const mockApi = {
  listServers: vi.fn(),
  createServer: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
  healthCheckServer: vi.fn(),
  testServer: vi.fn(),
};

vi.mock("../api.js", () => ({
  api: {
    listServers: (...args: unknown[]) => mockApi.listServers(...args),
    createServer: (...args: unknown[]) => mockApi.createServer(...args),
    updateServer: (...args: unknown[]) => mockApi.updateServer(...args),
    deleteServer: (...args: unknown[]) => mockApi.deleteServer(...args),
    healthCheckServer: (...args: unknown[]) => mockApi.healthCheckServer(...args),
    testServer: (...args: unknown[]) => mockApi.testServer(...args),
  },
}));

// Mock createPortal so modals render inline for testing
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  };
});

import { ServerManager } from "./ServerManager.js";

function makeServer(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test Server",
    slug: "test-server",
    url: "http://test.tail.ts.net:3456",
    authToken: "***",
    sshUser: "seb",
    tailscaleHostname: "test",
    description: "A test server",
    enabled: true,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.listServers.mockResolvedValue([]);
  mockApi.healthCheckServer.mockResolvedValue({ ok: true, latencyMs: 42 });
  mockApi.createServer.mockResolvedValue(makeServer());
  mockApi.updateServer.mockResolvedValue(makeServer({ name: "Updated" }));
  mockApi.deleteServer.mockResolvedValue({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════════

describe("ServerManager", () => {
  it("renders in embedded mode with title and empty state", async () => {
    // Validates that the component renders correctly when no servers exist
    render(<ServerManager embedded />);
    await waitFor(() => {
      expect(screen.getByText("Servers")).toBeInTheDocument();
    });
    expect(screen.getByText("No servers configured yet.")).toBeInTheDocument();
  });

  it("renders server list in embedded mode", async () => {
    // Validates that servers fetched from the API are rendered in the list
    mockApi.listServers.mockResolvedValue([
      makeServer(),
      makeServer({ name: "GPU Server", slug: "gpu-server", tailscaleHostname: "gpu" }),
    ]);
    render(<ServerManager embedded />);
    await waitFor(() => {
      expect(screen.getByText("Test Server")).toBeInTheDocument();
    });
    expect(screen.getByText("GPU Server")).toBeInTheDocument();
    expect(screen.getByText("2 servers")).toBeInTheDocument();
  });

  it("renders in modal mode with close button", async () => {
    // Validates modal rendering with close handler and title
    const onClose = vi.fn();
    render(<ServerManager onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText("Manage Servers")).toBeInTheDocument();
    });
    const closeBtn = screen.getByLabelText("Close");
    expect(closeBtn).toBeInTheDocument();
  });

  it("renders disabled badge for disabled servers", async () => {
    // Validates that disabled servers show a visual indicator
    mockApi.listServers.mockResolvedValue([
      makeServer({ enabled: false }),
    ]);
    render(<ServerManager embedded />);
    await waitFor(() => {
      expect(screen.getByText("disabled")).toBeInTheDocument();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Accessibility
  // ═══════════════════════════════════════════════════════════════════════

  it("has no accessibility violations in embedded mode", async () => {
    // Axe accessibility scan for the embedded page view
    mockApi.listServers.mockResolvedValue([makeServer()]);
    const { container } = render(<ServerManager embedded />);
    await waitFor(() => {
      expect(screen.getByText("Test Server")).toBeInTheDocument();
    });
    const { axe } = await import("vitest-axe");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Interactions
  // ═══════════════════════════════════════════════════════════════════════

  it("opens create form when New Server is clicked", async () => {
    // Validates that the create form toggles open with required fields
    render(<ServerManager embedded />);
    await waitFor(() => {
      expect(screen.getByText("Servers")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("New Server"));

    expect(
      screen.getByPlaceholderText("Server name (e.g. Mac Mini M4)"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/URL/),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Auth token from remote server"),
    ).toBeInTheDocument();
  });

  it("calls deleteServer when delete button is clicked", async () => {
    // Validates that clicking delete triggers the API call and refreshes the list
    mockApi.listServers
      .mockResolvedValueOnce([makeServer()])
      .mockResolvedValueOnce([]);

    render(<ServerManager embedded />);
    await waitFor(() => {
      expect(screen.getByText("Test Server")).toBeInTheDocument();
    });

    const deleteBtn = screen.getByLabelText("Delete");
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(mockApi.deleteServer).toHaveBeenCalledWith("test-server");
    });
  });

  it("opens edit form when edit button is clicked", async () => {
    // Validates that clicking edit populates the form with server data
    mockApi.listServers.mockResolvedValue([makeServer()]);

    render(<ServerManager embedded />);
    await waitFor(() => {
      expect(screen.getByText("Test Server")).toBeInTheDocument();
    });

    const editBtn = screen.getByLabelText("Edit");
    fireEvent.click(editBtn);

    // Edit form should be visible with pre-populated values
    await waitFor(() => {
      expect(screen.getByDisplayValue("Test Server")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("http://test.tail.ts.net:3456")).toBeInTheDocument();
    expect(screen.getByDisplayValue("seb")).toBeInTheDocument();
  });

  it("calls healthCheckServer when check health button is clicked", async () => {
    // Validates that clicking the health check button triggers the API call
    mockApi.listServers.mockResolvedValue([makeServer()]);

    render(<ServerManager embedded />);
    await waitFor(() => {
      expect(screen.getByText("Test Server")).toBeInTheDocument();
    });

    const healthBtn = screen.getByLabelText("Check health");
    fireEvent.click(healthBtn);

    await waitFor(() => {
      // healthCheckServer is called once automatically on load + once on click
      expect(mockApi.healthCheckServer).toHaveBeenCalledWith("test-server");
    });
  });
});
