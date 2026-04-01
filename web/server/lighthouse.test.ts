import { describe, it, expect } from "vitest";

describe("lighthouse mode detection", () => {
  it("exports isLighthouseMode as a boolean", async () => {
    // Validates that the lighthouse module exports a deterministic boolean
    // (in test environment COMPANION_LIGHTHOUSE is not set, so should be false)
    const { isLighthouseMode } = await import("./lighthouse.js");
    expect(typeof isLighthouseMode).toBe("boolean");
    // In test env, COMPANION_LIGHTHOUSE is not set
    expect(isLighthouseMode).toBe(false);
  });
});
