/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type FC,
  type FormEventHandler,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  useLocation,
  useNavigate,
  type Location as RouterLocation,
} from "react-router-dom";
import { Button, Heading, Text } from "@vector-im/compound-web";
import { logger } from "matrix-js-sdk/lib/logger";

import { useClient, useClientState } from "../ClientContext";
import { ErrorPage, LoadingPage } from "../FullScreenView";
import { FieldRow, InputField, ErrorMessage } from "../input/Input";
import { Form } from "../form/Form";
import { HeaderLogo } from "../Header";
import { widget } from "../widget";
import { usePageTitle } from "../usePageTitle";
import { PosthogAnalytics } from "../analytics/PosthogAnalytics";
import commonStyles from "../home/common.module.css";
import styles from "./LoginPage.module.css";
import {
  type CustomServerLoginConfig,
  discoverCustomServerLogin,
} from "./customServer";
import { startMasAuth } from "./mas";
import { useInteractiveLogin } from "./useInteractiveLogin";

interface LocationState {
  from?: RouterLocation;
}

export const LoginPage: FC = () => {
  usePageTitle("Log in");
  const clientState = useClientState();
  const { client, setClient } = useClient();
  const login = useInteractiveLogin(client);
  const location = useLocation();
  const navigate = useNavigate();
  const [serverFormOpen, setServerFormOpen] = useState(false);
  const [customServer, setCustomServer] = useState<CustomServerLoginConfig>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error>();

  const returnUrl = getReturnUrl(location);

  useEffect(() => {
    if (clientState?.state !== "valid" || !clientState.authenticated) {
      return;
    }

    navigate(returnUrl, { replace: true })?.catch((error) => {
      logger.error("Failed to navigate after login", error);
    });
  }, [clientState, navigate, returnUrl]);

  const onDefaultMasLogin = useCallback(() => {
    setError(undefined);
    setLoading(true);

    startMasAuth("login", returnUrl).catch((error) => {
      logger.error("Failed to start MAS authentication", error);
      setError(error instanceof Error ? error : new Error(String(error)));
      setLoading(false);
    });
  }, [returnUrl]);

  const onDiscoverCustomServer: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      setError(undefined);
      setLoading(true);

      const data = new FormData(event.currentTarget);
      const serverName = data.get("serverName");
      if (typeof serverName !== "string") {
        setError(new Error("Enter a server name."));
        setLoading(false);
        return;
      }

      discoverCustomServerLogin(serverName)
        .then(async (config) => {
          if (config.delegatedAuthConfig) {
            await startMasAuth("login", returnUrl, {
              homeserverUrl: config.homeserverUrl,
              delegatedAuthConfig: config.delegatedAuthConfig,
            });
            return;
          }

          if (!config.passwordLoginSupported) {
            throw new Error(
              "This server does not support MAS or password login.",
            );
          }

          setCustomServer(config);
        })
        .catch((error) => {
          logger.error("Failed to discover custom server login", error);
          setError(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => setLoading(false));
    },
    [returnUrl],
  );

  const onPasswordLogin: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      if (!customServer || !setClient) {
        return;
      }

      setError(undefined);
      setLoading(true);

      const data = new FormData(event.currentTarget);
      const username = data.get("username");
      const password = data.get("password");
      if (typeof username !== "string" || typeof password !== "string") {
        setError(new Error("Enter a username and password."));
        setLoading(false);
        return;
      }

      login(
        customServer.homeserverUrl,
        username,
        password,
        customServer.serverName,
      )
        .then(async ([client, session]) => {
          setClient(client, session);
          await navigate(returnUrl, { replace: true });
          PosthogAnalytics.instance.eventLogin.track();
        })
        .catch((error) => {
          logger.error("Failed to log in with password", error);
          setError(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => setLoading(false));
    },
    [customServer, login, navigate, returnUrl, setClient],
  );

  if (!clientState) {
    return <LoadingPage />;
  }

  if (clientState.state === "error") {
    return <ErrorPage widget={widget} error={clientState.error} />;
  }

  return (
    <div className={commonStyles.container}>
      <main className={commonStyles.main}>
        <HeaderLogo className={styles.logo} />
        <div className={styles.content}>
          <Heading size="lg" weight="semibold" className={styles.headline}>
            Sign in to Element Call
          </Heading>
          <Text size="sm" className={styles.body}>
            Use fob.wtf for the managed call server, or connect with another
            Matrix homeserver.
          </Text>

          {!customServer && (
            <>
              <div className={styles.actions}>
                <Button
                  type="button"
                  size="lg"
                  onClick={onDefaultMasLogin}
                  disabled={loading}
                  data-testid="login_default_mas"
                >
                  Continue with fob.wtf
                </Button>
                {serverFormOpen ? (
                  <Form
                    className={styles.serverForm}
                    onSubmit={onDiscoverCustomServer}
                  >
                    <FieldRow className={styles.serverRow}>
                      <InputField
                        id="serverName"
                        name="serverName"
                        label="Server name"
                        placeholder="matrix.org"
                        type="text"
                        required
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        disabled={loading}
                        data-testid="login_server_name"
                      />
                      <Button
                        type="submit"
                        size="lg"
                        disabled={loading}
                        data-testid="login_continue_custom"
                      >
                        {loading ? "Checking server" : "Continue"}
                      </Button>
                    </FieldRow>
                    {error && (
                      <FieldRow className={styles.serverError}>
                        <ErrorMessage error={error} />
                      </FieldRow>
                    )}
                  </Form>
                ) : (
                  <Button
                    type="button"
                    kind="secondary"
                    size="lg"
                    onClick={(): void => setServerFormOpen(true)}
                    disabled={loading}
                    data-testid="login_custom_server"
                  >
                    Use another server
                  </Button>
                )}
              </div>
            </>
          )}

          {customServer && (
            <Form className={styles.form} onSubmit={onPasswordLogin}>
              <FieldRow>
                <InputField
                  id="username"
                  name="username"
                  label="Username"
                  placeholder={`@alice:${customServer.serverName}`}
                  type="text"
                  required
                  autoComplete="username"
                  autoCorrect="off"
                  autoCapitalize="none"
                  disabled={loading}
                  data-testid="login_username"
                />
              </FieldRow>
              <FieldRow>
                <InputField
                  id="password"
                  name="password"
                  label="Password"
                  placeholder="Password"
                  type="password"
                  required
                  autoComplete="current-password"
                  disabled={loading}
                  data-testid="login_password"
                />
              </FieldRow>
              {error && (
                <FieldRow>
                  <ErrorMessage error={error} />
                </FieldRow>
              )}
              <FieldRow>
                <Button
                  type="submit"
                  size="lg"
                  disabled={loading}
                  data-testid="login_password_submit"
                >
                  {loading
                    ? "Signing in"
                    : `Sign in to ${customServer.serverName}`}
                </Button>
              </FieldRow>
            </Form>
          )}
        </div>
      </main>
    </div>
  );
};

function getReturnUrl(location: RouterLocation): string {
  const state = location.state as LocationState | null;
  const from = state?.from;
  if (!from) {
    return "/";
  }

  return `${from.pathname}${from.search}${from.hash}`;
}
