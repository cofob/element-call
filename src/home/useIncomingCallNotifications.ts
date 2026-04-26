/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  EventType,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomEvent,
} from "matrix-js-sdk";
import { useCallback, useEffect, useState } from "react";
import {
  MatrixRTCSessionManagerEvents,
  parseCallNotificationContent,
  type RTCCallIntent,
} from "matrix-js-sdk/lib/matrixrtc";

export interface IncomingCallNotification {
  room: Room;
  eventId: string;
  sender: string;
  intent?: RTCCallIntent;
  expiresAt: number;
}

export function getIncomingCallNotification(
  event: MatrixEvent,
  room: Room | undefined,
  localUserId: string | null,
  now = Date.now(),
): IncomingCallNotification | null {
  if (!room || event.getType() !== EventType.RTCNotification) return null;

  const eventId = event.getId();
  const sender = event.getSender();
  if (!eventId || !sender || sender === localUserId) return null;

  let content;
  try {
    content = parseCallNotificationContent(event.getContent());
  } catch {
    return null;
  }

  if (content.notification_type !== "ring") return null;

  const expiresAt = content.sender_ts + content.lifetime;
  if (expiresAt <= now) return null;

  return {
    room,
    eventId,
    sender,
    intent: content["m.call.intent"],
    expiresAt,
  };
}

function uniqueCalls(
  calls: IncomingCallNotification[],
): IncomingCallNotification[] {
  const deduped = new Map<string, IncomingCallNotification>();
  for (const call of calls) {
    deduped.set(call.eventId, call);
  }
  return Array.from(deduped.values()).sort((a, b) => b.expiresAt - a.expiresAt);
}

export function useIncomingCallNotifications(
  client: MatrixClient,
): IncomingCallNotification[] {
  const [incomingCalls, setIncomingCalls] = useState<
    IncomingCallNotification[]
  >([]);

  const removeExpiredCalls = useCallback(() => {
    const now = Date.now();
    setIncomingCalls((calls) => calls.filter((call) => call.expiresAt > now));
  }, []);

  const addIncomingCall = useCallback((call: IncomingCallNotification) => {
    const now = Date.now();
    setIncomingCalls((calls) =>
      uniqueCalls([...calls.filter((c) => c.expiresAt > now), call]),
    );
  }, []);

  useEffect(() => {
    const localUserId = client.getUserId();
    const currentCalls = client
      .getRooms()
      .flatMap((room) =>
        room
          .getLiveTimeline()
          .getEvents()
          .map((event) =>
            getIncomingCallNotification(event, room, localUserId),
          ),
      )
      .filter((call): call is IncomingCallNotification => call !== null);
    setIncomingCalls(uniqueCalls(currentCalls));

    const onTimeline = (
      event: MatrixEvent,
      room: Room | undefined,
      toStartOfTimeline?: boolean,
      removed?: boolean,
    ): void => {
      if (toStartOfTimeline || removed) return;

      const call = getIncomingCallNotification(event, room, localUserId);
      if (call) addIncomingCall(call);
    };

    const onSessionEnded = (roomId: string): void => {
      setIncomingCalls((calls) =>
        calls.filter((call) => call.room.roomId !== roomId),
      );
    };

    client.on(RoomEvent.Timeline, onTimeline);
    client.matrixRTC.on(
      MatrixRTCSessionManagerEvents.SessionEnded,
      onSessionEnded,
    );
    return (): void => {
      client.off(RoomEvent.Timeline, onTimeline);
      client.matrixRTC.off(
        MatrixRTCSessionManagerEvents.SessionEnded,
        onSessionEnded,
      );
    };
  }, [addIncomingCall, client]);

  useEffect(() => {
    if (incomingCalls.length === 0) return;

    const nextExpiry = Math.min(...incomingCalls.map((call) => call.expiresAt));
    const timeout = window.setTimeout(
      removeExpiredCalls,
      Math.max(0, nextExpiry - Date.now()) + 50,
    );
    return (): void => window.clearTimeout(timeout);
  }, [incomingCalls, removeExpiredCalls]);

  return incomingCalls;
}
