/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { AutoDiscovery } from "matrix-js-sdk/lib/autodiscovery";
import {
  createClient,
  MatrixError,
  type LoginFlow,
  type OidcClientConfig,
} from "matrix-js-sdk";

export interface CustomServerLoginConfig {
  serverName: string;
  homeserverUrl: string;
  delegatedAuthConfig?: OidcClientConfig;
  passwordLoginSupported: boolean;
}

export function normalizeServerName(serverName: string): string {
  const trimmed = serverName.trim();
  if (!trimmed) {
    throw new Error("Enter a server name.");
  }

  if (trimmed.includes("://")) {
    return new URL(trimmed).hostname;
  }

  if (trimmed.includes("/")) {
    throw new Error("Enter a server name, for example fob.wtf.");
  }

  return trimmed;
}

export async function discoverCustomServerLogin(
  serverNameInput: string,
): Promise<CustomServerLoginConfig> {
  const serverName = normalizeServerName(serverNameInput);
  const discoveryResult = await AutoDiscovery.findClientConfig(serverName);
  const homeserver = discoveryResult["m.homeserver"];
  const homeserverUrl = homeserver.base_url;

  if (homeserver.state !== AutoDiscovery.SUCCESS || !homeserverUrl) {
    throw new Error(
      `Could not discover a usable homeserver for ${serverName}.`,
    );
  }

  const client = createClient({ baseUrl: homeserverUrl });
  const delegatedAuthConfig = await discoverDelegatedAuth(client);
  if (delegatedAuthConfig) {
    return {
      serverName,
      homeserverUrl,
      delegatedAuthConfig,
      passwordLoginSupported: false,
    };
  }

  const { flows } = await client.loginFlows();

  return {
    serverName,
    homeserverUrl,
    passwordLoginSupported: flows.some(isPasswordFlow),
  };
}

async function discoverDelegatedAuth(
  client: ReturnType<typeof createClient>,
): Promise<OidcClientConfig | undefined> {
  try {
    return await client.getAuthMetadata();
  } catch (error) {
    if (
      error instanceof MatrixError &&
      error.httpStatus === 404 &&
      error.errcode === "M_UNRECOGNIZED"
    ) {
      return undefined;
    }

    throw error;
  }
}

function isPasswordFlow(flow: LoginFlow): boolean {
  return flow.type === "m.login.password";
}
