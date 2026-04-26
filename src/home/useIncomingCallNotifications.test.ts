/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { EventType, MatrixEvent, type Room } from "matrix-js-sdk";
import { describe, expect, it } from "vitest";

import { getIncomingCallNotification } from "./useIncomingCallNotifications";

function makeEvent(
  content: Record<string, unknown>,
  sender = "@alice:example.org",
): MatrixEvent {
  return new MatrixEvent({
    event_id: "$ring",
    room_id: "!room:example.org",
    sender,
    type: EventType.RTCNotification,
    content,
  });
}

describe("getIncomingCallNotification", () => {
  const room = {
    roomId: "!room:example.org",
  } as Room;

  it("parses valid incoming ring notifications", () => {
    const call = getIncomingCallNotification(
      makeEvent({
        notification_type: "ring",
        sender_ts: 1000,
        lifetime: 30000,
        "m.call.intent": "video",
      }),
      room,
      "@me:example.org",
      2000,
    );

    expect(call).toMatchObject({
      room,
      eventId: "$ring",
      sender: "@alice:example.org",
      intent: "video",
      expiresAt: 31000,
    });
  });

  it("ignores notifications from the local user", () => {
    expect(
      getIncomingCallNotification(
        makeEvent(
          {
            notification_type: "ring",
            sender_ts: 1000,
            lifetime: 30000,
          },
          "@me:example.org",
        ),
        room,
        "@me:example.org",
        2000,
      ),
    ).toBeNull();
  });

  it("ignores non-ring and expired notifications", () => {
    expect(
      getIncomingCallNotification(
        makeEvent({
          notification_type: "notification",
          sender_ts: 1000,
          lifetime: 30000,
        }),
        room,
        "@me:example.org",
        2000,
      ),
    ).toBeNull();

    expect(
      getIncomingCallNotification(
        makeEvent({
          notification_type: "ring",
          sender_ts: 1000,
          lifetime: 1000,
        }),
        room,
        "@me:example.org",
        2000,
      ),
    ).toBeNull();
  });

  it("ignores malformed notifications", () => {
    expect(
      getIncomingCallNotification(
        makeEvent({ notification_type: "ring" }),
        room,
        "@me:example.org",
        2000,
      ),
    ).toBeNull();
  });
});
