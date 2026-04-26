/*
Copyright 2022-2024 New Vector Ltd.
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { useCallback } from "react";
import { InteractiveAuth } from "matrix-js-sdk";
import {
  createClient,
  type LoginResponse,
  type MatrixClient,
} from "matrix-js-sdk";

import { initClient } from "../utils/matrix";
import { type Session } from "../ClientContext";

export function useInteractiveLogin(
  oldClient?: MatrixClient,
): (
  homeserver: string,
  username: string,
  password: string,
  serverName?: string,
) => Promise<[MatrixClient, Session]> {
  return useCallback<
    (
      homeserver: string,
      username: string,
      password: string,
      serverName?: string,
    ) => Promise<[MatrixClient, Session]>
  >(
    async (
      homeserver: string,
      username: string,
      password: string,
      serverName?: string,
    ) => {
      const authClient = createClient({ baseUrl: homeserver });

      const interactiveAuth = new InteractiveAuth({
        matrixClient: authClient,
        doRequest: async (): Promise<LoginResponse> =>
          authClient.login("m.login.password", {
            identifier: {
              type: "m.id.user",
              user: username,
            },
            password,
          }),
        stateUpdated: (): void => {},
        requestEmailToken: async (): Promise<{ sid: string }> =>
          Promise.resolve({ sid: "" }),
      });

      /* eslint-disable camelcase,@typescript-eslint/no-explicit-any */
      const { user_id, access_token, device_id } =
        (await interactiveAuth.attemptAuth()) as any;
      const session: Session = {
        user_id,
        access_token,
        device_id,
        homeserver_url: homeserver,
        server_name: serverName,
        passwordlessUser: false,
      };

      await oldClient?.logout(true);
      const client = await initClient(
        {
          baseUrl: homeserver,
          accessToken: access_token,
          userId: user_id,
          deviceId: device_id,
        },
        false,
      );
      /* eslint-enable camelcase */

      return [client, session];
    },
    [oldClient],
  );
}
