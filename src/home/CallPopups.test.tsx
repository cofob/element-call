/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  EventType,
  MatrixEvent,
  type MatrixClient,
  type Room,
  type RoomMember,
} from "matrix-js-sdk";
import { MatrixRTCSessionManagerEvents } from "matrix-js-sdk/lib/matrixrtc";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { CallPopups } from "./CallPopups";
import { type GroupCallRoom } from "./useGroupCallRooms";

function makeRoom(events: MatrixEvent[] = []): Room {
  return {
    roomId: "!room:example.org",
    name: "Mission Control",
    getMxcAvatarUrl: () => null,
    getLiveTimeline: () => ({
      getEvents: () => events,
    }),
    getMember: (userId: string) =>
      ({
        userId,
        rawDisplayName: "Alice",
      }) as RoomMember,
  } as unknown as Room;
}

function makeClient(rooms: Room[] = []): MatrixClient {
  return {
    getUserId: () => "@me:example.org",
    getRooms: () => rooms,
    on: vi.fn(),
    off: vi.fn(),
    matrixRTC: {
      on: vi.fn(),
      off: vi.fn(),
    },
    sendRtcDecline: vi.fn().mockResolvedValue({ event_id: "$decline" }),
  } as unknown as MatrixClient;
}

function renderPopups(
  client: MatrixClient,
  currentCalls: GroupCallRoom[] = [],
): void {
  render(
    <MemoryRouter>
      <CallPopups client={client} currentCalls={currentCalls} />
    </MemoryRouter>,
  );
}

describe("CallPopups", () => {
  it("renders and dismisses current calls locally", async () => {
    const user = userEvent.setup();
    const room = makeRoom();
    const client = makeClient();
    const currentCalls = [
      {
        room,
        roomName: room.name,
        avatarUrl: "",
        session: {
          memberships: [{ userId: "@alice:example.org" }],
        },
        participants: [],
      },
    ] as unknown as GroupCallRoom[];

    renderPopups(client, currentCalls);

    expect(screen.getByText("Current call")).toBeInTheDocument();
    expect(screen.getByText("Mission Control")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText("Current call")).not.toBeInTheDocument();
  });

  it("renders incoming ring calls and declines them", async () => {
    const user = userEvent.setup();
    const room = makeRoom([
      new MatrixEvent({
        event_id: "$ring",
        room_id: "!room:example.org",
        sender: "@alice:example.org",
        type: EventType.RTCNotification,
        content: {
          notification_type: "ring",
          sender_ts: Date.now(),
          lifetime: 30000,
        },
      }),
    ]);
    const client = makeClient([room]);

    renderPopups(client);

    expect(screen.getByText("Incoming call")).toBeInTheDocument();
    expect(screen.getByText("From Alice")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Decline" }));

    expect(client.sendRtcDecline).toHaveBeenCalledWith(
      "!room:example.org",
      "$ring",
    );
    expect(screen.queryByText("Incoming call")).not.toBeInTheDocument();
  });

  it("subscribes to timeline and session-ended updates", () => {
    const client = makeClient();

    renderPopups(client);

    expect(client.on).toHaveBeenCalledWith(
      "Room.timeline",
      expect.any(Function),
    );
    expect(client.matrixRTC.on).toHaveBeenCalledWith(
      MatrixRTCSessionManagerEvents.SessionEnded,
      expect.any(Function),
    );
  });
});
