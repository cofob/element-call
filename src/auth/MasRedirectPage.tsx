/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useEffect, useState } from "react";
import {
  useLocation,
  useNavigate,
  type Location as RouterLocation,
} from "react-router-dom";
import { logger } from "matrix-js-sdk/lib/logger";

import { useClientState } from "../ClientContext";
import { ErrorPage, LoadingPage } from "../FullScreenView";
import { widget } from "../widget";
import { type MasAuthAction, startMasAuth } from "./mas";

interface Props {
  action: MasAuthAction;
}

interface LocationState {
  from?: RouterLocation;
}

export const MasRedirectPage: FC<Props> = ({ action }) => {
  const clientState = useClientState();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (widget || !clientState || clientState.state === "error") {
      return;
    }

    if (clientState.authenticated) {
      const state = location.state as LocationState | null;
      const from = state?.from;
      const returnUrl = from
        ? `${from.pathname}${from.search}${from.hash}`
        : "/";

      navigate(returnUrl, { replace: true })?.catch((error) => {
        logger.error("Failed to navigate after MAS login", error);
      });
      return;
    }

    const returnUrl =
      location.pathname === "/login" || location.pathname === "/register"
        ? "/"
        : `${location.pathname}${location.search}${location.hash}`;

    startMasAuth(action, returnUrl).catch((error) => {
      logger.error("Failed to start MAS authentication", error);
      setError(error instanceof Error ? error : new Error(String(error)));
    });
  }, [action, clientState, location, navigate]);

  if (clientState?.state === "error") {
    return <ErrorPage widget={widget} error={clientState.error} />;
  }

  if (error) {
    return <ErrorPage widget={widget} error={error} />;
  }

  return <LoadingPage />;
};
