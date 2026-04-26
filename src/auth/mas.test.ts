/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConfig } from "../utils/test";
import {
  completeMasLoginFromUrl,
  createOidcTokenRefreshFunction,
  hasMasCallbackParams,
  startMasAuth,
} from "./mas";

const mocks = vi.hoisted(() => ({
  completeAuthorizationCodeGrant: vi.fn(),
  createClient: vi.fn(),
  decodeIdToken: vi.fn(),
  discoverAndValidateOIDCIssuerWellKnown: vi.fn(),
  doRefreshAccessToken: vi.fn(),
  generateOidcAuthorizationUrl: vi.fn(),
  registerOidcClient: vi.fn(),
}));

vi.mock("matrix-js-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    createClient: mocks.createClient,
    decodeIdToken: mocks.decodeIdToken,
    discoverAndValidateOIDCIssuerWellKnown:
      mocks.discoverAndValidateOIDCIssuerWellKnown,
    OidcTokenRefresher: class {
      public doRefreshAccessToken = mocks.doRefreshAccessToken;
    },
    registerOidcClient: mocks.registerOidcClient,
  };
});

vi.mock("matrix-js-sdk/lib/oidc/authorize", () => ({
  completeAuthorizationCodeGrant: mocks.completeAuthorizationCodeGrant,
  generateOidcAuthorizationUrl: mocks.generateOidcAuthorizationUrl,
}));

describe("MAS auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig({
      default_server_config: {
        "m.homeserver": {
          base_url: "https://matrix.example.org",
          server_name: "example.org",
        },
      },
      oidc_static_clients: {
        "https://issuer.example.org/": {
          client_id: "static-client",
        },
      },
    });
    window.history.replaceState(null, "", "/");
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("detects MAS callback parameters in query and fragment", () => {
    window.history.replaceState(null, "", "/room/test?code=abc&state=def");
    expect(hasMasCallbackParams()).toBe(true);

    window.history.replaceState(null, "", "/room/test#code=abc&state=def");
    expect(hasMasCallbackParams()).toBe(true);

    window.history.replaceState(null, "", "/room/test");
    expect(hasMasCallbackParams()).toBe(false);
  });

  it("starts MAS with a static client ID and registration prompt", async () => {
    const redirect = vi.fn();
    mocks.createClient.mockReturnValue({
      getAuthMetadata: vi.fn().mockResolvedValue({
        issuer: "https://issuer.example.org",
        response_modes_supported: ["query"],
      }),
    });
    mocks.generateOidcAuthorizationUrl.mockResolvedValue(
      "https://issuer.example.org/auth",
    );

    await startMasAuth("register", "/room/test", redirect);

    expect(mocks.registerOidcClient).not.toHaveBeenCalled();
    expect(mocks.generateOidcAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "static-client",
        homeserverUrl: "https://matrix.example.org",
        prompt: "create",
        responseMode: "query",
      }),
    );
    expect(sessionStorage.getItem("element-call-oidc-return-url")).toBe(
      "/room/test",
    );
    expect(redirect).toHaveBeenCalledWith("https://issuer.example.org/auth");
  });

  it("dynamically registers when no static client ID is configured", async () => {
    mockConfig({
      default_server_config: {
        "m.homeserver": {
          base_url: "https://matrix.example.org",
          server_name: "example.org",
        },
      },
    });
    const redirect = vi.fn();
    mocks.createClient.mockReturnValue({
      getAuthMetadata: vi.fn().mockResolvedValue({
        issuer: "https://issuer.example.org",
        response_modes_supported: ["fragment"],
      }),
    });
    mocks.registerOidcClient.mockResolvedValue("dynamic-client");
    mocks.generateOidcAuthorizationUrl.mockResolvedValue(
      "https://issuer.example.org/auth",
    );

    await startMasAuth("login", "/", redirect);

    expect(mocks.registerOidcClient).toHaveBeenCalled();
    expect(mocks.generateOidcAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "dynamic-client",
        prompt: undefined,
        responseMode: "fragment",
      }),
    );
  });

  it("completes a MAS callback and persists an Element Call session", async () => {
    const saveSession = vi.fn();
    sessionStorage.setItem(
      "element-call-oidc-return-url",
      "/room/test?roomId=!abc:example.org",
    );
    window.history.replaceState(null, "", "/room/test?code=abc&state=def");
    mocks.completeAuthorizationCodeGrant.mockResolvedValue({
      homeserverUrl: "https://matrix.example.org",
      tokenResponse: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        id_token: "id-token",
      },
      oidcClientSettings: {
        clientId: "client-id",
        issuer: "https://issuer.example.org",
      },
    });
    mocks.createClient.mockReturnValue({
      whoami: vi.fn().mockResolvedValue({
        user_id: "@alice:example.org",
        device_id: "DEVICE",
        is_guest: false,
      }),
    });

    const session = await completeMasLoginFromUrl(saveSession);

    expect(mocks.completeAuthorizationCodeGrant).toHaveBeenCalledWith(
      "abc",
      "def",
      "query",
    );
    expect(session).toEqual({
      user_id: "@alice:example.org",
      device_id: "DEVICE",
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      oidc_client_id: "client-id",
      oidc_issuer: "https://issuer.example.org",
      passwordlessUser: false,
    });
    expect(saveSession).toHaveBeenCalledWith(session);
    expect(window.location.pathname).toBe("/room/test");
    expect(window.location.search).toBe("?roomId=!abc:example.org");
  });

  it("persists refreshed OIDC tokens", async () => {
    const saveSession = vi.fn();
    mocks.decodeIdToken.mockReturnValue({ sub: "@alice:example.org" });
    mocks.doRefreshAccessToken.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    });

    const refresh = createOidcTokenRefreshFunction(
      {
        user_id: "@alice:example.org",
        device_id: "DEVICE",
        access_token: "old-access-token",
        refresh_token: "old-refresh-token",
        id_token: "id-token",
        oidc_client_id: "client-id",
        oidc_issuer: "https://issuer.example.org",
        passwordlessUser: false,
      },
      saveSession,
    );

    await expect(refresh?.("old-refresh-token")).resolves.toEqual({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    });
    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
      }),
    );
  });
});
