/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  createClient,
  decodeIdToken,
  discoverAndValidateOIDCIssuerWellKnown,
  OidcTokenRefresher,
  registerOidcClient,
  type OidcClientConfig,
  type OidcRegistrationClientMetadata,
} from "matrix-js-sdk";
import { type AccessTokens } from "matrix-js-sdk/lib/http-api/interface";
import {
  completeAuthorizationCodeGrant,
  generateOidcAuthorizationUrl,
} from "matrix-js-sdk/lib/oidc/authorize";
import { logger } from "matrix-js-sdk/lib/logger";
import { secureRandomString } from "matrix-js-sdk/lib/randomstring";

import { Config } from "../config/Config";
import { type Session } from "../ClientContext";

const RETURN_URL_STORAGE_KEY = "element-call-oidc-return-url";

export type MasAuthAction = "login" | "register";

export interface StartMasAuthOptions {
  homeserverUrl?: string;
  delegatedAuthConfig?: OidcClientConfig;
  redirect?: (url: string) => void;
}

type ResponseMode = "fragment" | "query";

interface CallbackParams {
  code: string;
  state: string;
  responseMode: ResponseMode;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token: string;
}

interface OidcClientSettings {
  clientId: string;
  issuer: string;
}

interface CompleteAuthorizationResponse {
  homeserverUrl: string;
  identityServerUrl?: string;
  tokenResponse: TokenResponse;
  oidcClientSettings: OidcClientSettings;
}

interface RevocationMetadata {
  revocation_endpoint?: string;
}

export class MasConfigurationError extends Error {
  public constructor() {
    super(
      "This homeserver does not advertise delegated authentication metadata.",
    );
  }
}

export function hasMasCallbackParams(url: Location = window.location): boolean {
  return getCallbackParams(url) !== undefined;
}

export async function startMasAuth(
  action: MasAuthAction,
  returnUrl: string,
  optionsOrRedirect: StartMasAuthOptions | ((url: string) => void) = {},
): Promise<void> {
  const options =
    typeof optionsOrRedirect === "function"
      ? { redirect: optionsOrRedirect }
      : optionsOrRedirect;
  const redirect =
    options.redirect ?? ((url: string): void => window.location.assign(url));
  const homeserverUrl = options.homeserverUrl ?? Config.defaultHomeserverUrl();
  if (!homeserverUrl) {
    throw new Error("No homeserver is configured.");
  }

  const delegatedAuthConfig =
    options.delegatedAuthConfig ??
    (await getDelegatedAuthConfig(homeserverUrl));
  const clientId = await getOidcClientId(delegatedAuthConfig);
  const redirectUri = getOidcCallbackUrl().href;
  const responseMode = delegatedAuthConfig.response_modes_supported?.includes(
    "fragment",
  )
    ? "fragment"
    : "query";

  sessionStorage.setItem(RETURN_URL_STORAGE_KEY, sanitizeReturnUrl(returnUrl));

  const authorizationUrl = await generateOidcAuthorizationUrl({
    metadata: delegatedAuthConfig,
    redirectUri,
    clientId,
    homeserverUrl,
    nonce: secureRandomString(10),
    prompt: action === "register" ? "create" : undefined,
    responseMode,
  });

  redirect(authorizationUrl);
}

export async function completeMasLoginFromUrl(
  saveSession: (session: Session) => void,
): Promise<Session | null> {
  const callbackParams = getCallbackParams();
  if (!callbackParams) {
    return null;
  }

  const { code, state, responseMode } = callbackParams;
  const {
    homeserverUrl,
    tokenResponse,
    identityServerUrl,
    oidcClientSettings,
  } = (await completeAuthorizationCodeGrant(
    code,
    state,
    responseMode,
  )) as CompleteAuthorizationResponse;

  const whoamiClient = createClient({
    baseUrl: homeserverUrl,
    accessToken: tokenResponse.access_token,
    idBaseUrl: identityServerUrl,
  });
  const whoami = await whoamiClient.whoami();

  if (!whoami.user_id) {
    throw new Error("MAS login succeeded but did not return a Matrix user ID.");
  }

  if (whoami.is_guest) {
    throw new Error("Guest sessions are not supported.");
  }

  const session: Session = {
    user_id: whoami.user_id,
    device_id: whoami.device_id,
    access_token: tokenResponse.access_token,
    homeserver_url: homeserverUrl,
    refresh_token: tokenResponse.refresh_token,
    id_token: tokenResponse.id_token,
    oidc_client_id: oidcClientSettings.clientId,
    oidc_issuer: oidcClientSettings.issuer,
    passwordlessUser: false,
  };

  saveSession(session);
  replaceUrlAfterCallback();
  return session;
}

export function createOidcTokenRefreshFunction(
  session: Session,
  saveSession: (session: Session) => void,
): ((refreshToken: string) => Promise<AccessTokens>) | undefined {
  if (
    !session.refresh_token ||
    !session.oidc_client_id ||
    !session.oidc_issuer ||
    !session.id_token ||
    !session.device_id
  ) {
    return undefined;
  }

  const tokenRefresher = new OidcTokenRefresher(
    session.oidc_issuer,
    session.oidc_client_id,
    getOidcCallbackUrl().href,
    session.device_id,
    decodeIdToken(session.id_token),
  );

  return async (refreshToken: string): Promise<AccessTokens> => {
    const tokens = await tokenRefresher.doRefreshAccessToken(refreshToken);

    saveSession({
      ...session,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken ?? session.refresh_token,
    });

    return tokens;
  };
}

export async function revokeOidcSession(session?: Session): Promise<void> {
  if (
    !session?.oidc_issuer ||
    !session.oidc_client_id ||
    (!session.access_token && !session.refresh_token)
  ) {
    return;
  }

  const metadata = (await discoverAndValidateOIDCIssuerWellKnown(
    session.oidc_issuer,
  )) as RevocationMetadata;
  const revocationEndpoint = metadata.revocation_endpoint;
  if (!revocationEndpoint) {
    logger.warn("OIDC issuer did not advertise a token revocation endpoint.");
    return;
  }

  const results = await Promise.all([
    revokeToken(
      revocationEndpoint,
      session.oidc_client_id,
      session.access_token,
      "access_token",
    ),
    revokeToken(
      revocationEndpoint,
      session.oidc_client_id,
      session.refresh_token,
      "refresh_token",
    ),
  ]);

  if (results.some((success) => !success)) {
    throw new Error("Failed to revoke all OIDC tokens.");
  }
}

async function getDelegatedAuthConfig(
  homeserverUrl: string,
): Promise<OidcClientConfig> {
  const client = createClient({ baseUrl: homeserverUrl });
  try {
    return await client.getAuthMetadata();
  } catch (error) {
    logger.error("Failed to discover delegated authentication metadata", error);
    throw new MasConfigurationError();
  }
}

async function getOidcClientId(
  delegatedAuthConfig: OidcClientConfig,
): Promise<string> {
  const issuer = delegatedAuthConfig.issuer.endsWith("/")
    ? delegatedAuthConfig.issuer
    : `${delegatedAuthConfig.issuer}/`;
  const staticClientId = Config.get().oidc_static_clients?.[issuer]?.client_id;

  if (staticClientId) {
    return staticClientId;
  }

  return registerOidcClient(delegatedAuthConfig, getOidcClientMetadata());
}

function getOidcClientMetadata(): OidcRegistrationClientMetadata {
  const config = Config.get();

  return {
    clientName: import.meta.env.VITE_PRODUCT_NAME || "Element Call",
    clientUri: config.oidc_metadata?.client_uri ?? window.location.origin,
    redirectUris: [getOidcCallbackUrl().href],
    logoUri: config.oidc_metadata?.logo_uri,
    applicationType: "web",
    contacts: config.oidc_metadata?.contacts,
    tosUri: config.oidc_metadata?.tos_uri ?? config.ssla,
    policyUri: config.oidc_metadata?.policy_uri,
  };
}

function getOidcCallbackUrl(): URL {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("no_universal_links", "true");
  return url;
}

function getCallbackParams(
  url: Location = window.location,
): CallbackParams | undefined {
  const queryParams = new URLSearchParams(url.search);
  const queryCode = queryParams.get("code");
  const queryState = queryParams.get("state");
  if (queryCode && queryState) {
    return { code: queryCode, state: queryState, responseMode: "query" };
  }

  const fragmentParams = getFragmentParams(url.hash);
  const fragmentCode = fragmentParams.get("code");
  const fragmentState = fragmentParams.get("state");
  if (fragmentCode && fragmentState) {
    return {
      code: fragmentCode,
      state: fragmentState,
      responseMode: "fragment",
    };
  }

  return undefined;
}

function getFragmentParams(hash: string): URLSearchParams {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment.startsWith("?")) {
    return new URLSearchParams(fragment.slice(1));
  }

  return fragment.includes("=")
    ? new URLSearchParams(fragment)
    : new URLSearchParams();
}

function replaceUrlAfterCallback(): void {
  const storedReturnUrl = sessionStorage.getItem(RETURN_URL_STORAGE_KEY);
  sessionStorage.removeItem(RETURN_URL_STORAGE_KEY);

  const returnUrl = sanitizeReturnUrl(storedReturnUrl ?? "/");
  window.history.replaceState(null, "", returnUrl);
}

function sanitizeReturnUrl(returnUrl: string): string {
  const url = new URL(returnUrl, window.location.origin);
  if (url.origin !== window.location.origin) {
    return "/";
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

async function revokeToken(
  revocationEndpoint: string,
  clientId: string,
  token: string | undefined,
  tokenType: "access_token" | "refresh_token",
): Promise<boolean> {
  if (!token) {
    return true;
  }

  const body = new URLSearchParams({
    token,
    token_type_hint: tokenType,
    client_id: clientId,
  });

  try {
    const response = await fetch(revocationEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    return response.ok;
  } catch (error) {
    logger.error(`Failed to revoke ${tokenType}`, error);
    return false;
  }
}
