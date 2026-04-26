/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixError } from "matrix-js-sdk";

import { discoverCustomServerLogin, normalizeServerName } from "./customServer";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  findClientConfig: vi.fn(),
}));

vi.mock("matrix-js-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    createClient: mocks.createClient,
  };
});

vi.mock("matrix-js-sdk/lib/autodiscovery", () => ({
  AutoDiscovery: {
    SUCCESS: "SUCCESS",
    findClientConfig: mocks.findClientConfig,
  },
}));

describe("custom server login discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findClientConfig.mockResolvedValue({
      "m.homeserver": {
        state: "SUCCESS",
        base_url: "https://matrix.example.org",
      },
    });
  });

  it("normalizes server names", () => {
    expect(normalizeServerName(" example.org ")).toBe("example.org");
    expect(normalizeServerName("https://example.org/path")).toBe("example.org");
    expect(() => normalizeServerName("example.org/path")).toThrow(
      "Enter a server name",
    );
  });

  it("prefers delegated auth when the custom server advertises MAS", async () => {
    const delegatedAuthConfig = { issuer: "https://issuer.example.org" };
    mocks.createClient.mockReturnValue({
      getAuthMetadata: vi.fn().mockResolvedValue(delegatedAuthConfig),
      loginFlows: vi.fn(),
    });

    await expect(discoverCustomServerLogin("example.org")).resolves.toEqual({
      serverName: "example.org",
      homeserverUrl: "https://matrix.example.org",
      delegatedAuthConfig,
      passwordLoginSupported: false,
    });
  });

  it("falls back to password login when MAS is not supported", async () => {
    const unsupportedMasError = new MatrixError(
      { errcode: "M_UNRECOGNIZED" },
      404,
    );
    mocks.createClient.mockReturnValue({
      getAuthMetadata: vi.fn().mockRejectedValue(unsupportedMasError),
      loginFlows: vi.fn().mockResolvedValue({
        flows: [{ type: "m.login.password" }],
      }),
    });

    await expect(discoverCustomServerLogin("example.org")).resolves.toEqual({
      serverName: "example.org",
      homeserverUrl: "https://matrix.example.org",
      passwordLoginSupported: true,
    });
  });
});
