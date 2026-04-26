/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useCallback, useMemo, useState } from "react";
import { type MatrixClient, type Room } from "matrix-js-sdk";
import { Button, Text } from "@vector-im/compound-web";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { logger } from "matrix-js-sdk/lib/logger";

import { Avatar, Size } from "../Avatar";
import { getRelativeRoomUrl } from "../utils/matrix";
import { useRoomEncryptionSystem } from "../e2ee/sharedKeyManagement";
import { type GroupCallRoom } from "./useGroupCallRooms";
import {
  type IncomingCallNotification,
  useIncomingCallNotifications,
} from "./useIncomingCallNotifications";
import styles from "./CallPopups.module.css";

interface Props {
  client: MatrixClient;
  currentCalls: GroupCallRoom[];
}

function useGoToRoom(room: Room): () => void {
  const navigate = useNavigate();
  const encryptionSystem = useRoomEncryptionSystem(room.roomId);

  return useCallback(() => {
    Promise.resolve(
      navigate(getRelativeRoomUrl(room.roomId, encryptionSystem, room.name)),
    ).catch((error: unknown) =>
      logger.error("Failed to navigate to call", error),
    );
  }, [encryptionSystem, navigate, room]);
}

function getParticipantCount(call: GroupCallRoom): number {
  const userIds = new Set(
    call.session.memberships.map((membership) => membership.userId),
  );
  return userIds.size;
}

interface CallDetailsProps {
  room: Room;
  title: string;
  meta: string;
}

const CallDetails: FC<CallDetailsProps> = ({ room, title, meta }) => (
  <div className={styles.header}>
    <Avatar
      id={room.roomId}
      name={room.name}
      size={Size.MD}
      src={room.getMxcAvatarUrl() ?? undefined}
    />
    <div className={styles.details}>
      <Text size="sm" weight="semibold" className={styles.title}>
        {title}
      </Text>
      <Text size="sm" className={styles.roomName}>
        {room.name}
      </Text>
      <Text size="sm" className={styles.meta}>
        {meta}
      </Text>
    </div>
  </div>
);

interface CurrentCallCardProps {
  call: GroupCallRoom;
  onDismiss: (roomId: string) => void;
}

const CurrentCallCard: FC<CurrentCallCardProps> = ({ call, onDismiss }) => {
  const { t } = useTranslation();
  const goToRoom = useGoToRoom(call.room);
  const participantCount = getParticipantCount(call);

  return (
    <section className={styles.card}>
      <CallDetails
        room={call.room}
        title={t("call_popups.current_title")}
        meta={t("call_popups.participants", { count: participantCount })}
      />
      <div className={styles.actions}>
        <Button
          kind="tertiary"
          size="sm"
          onClick={() => onDismiss(call.room.roomId)}
        >
          {t("action.dismiss")}
        </Button>
        <Button kind="primary" size="sm" onClick={goToRoom}>
          {t("call_popups.join")}
        </Button>
      </div>
    </section>
  );
};

interface IncomingCallCardProps {
  call: IncomingCallNotification;
  client: MatrixClient;
  onDismiss: (eventId: string) => void;
}

const IncomingCallCard: FC<IncomingCallCardProps> = ({
  call,
  client,
  onDismiss,
}) => {
  const { t } = useTranslation();
  const goToRoom = useGoToRoom(call.room);
  const [declining, setDeclining] = useState(false);

  const callerName =
    call.room.getMember(call.sender)?.rawDisplayName ?? call.sender;

  const onDecline = useCallback(() => {
    setDeclining(true);
    client
      .sendRtcDecline(call.room.roomId, call.eventId)
      .then(() => onDismiss(call.eventId))
      .catch((error) => {
        logger.error("Failed to decline incoming call", error);
        setDeclining(false);
      });
  }, [call, client, onDismiss]);

  return (
    <section className={styles.card}>
      <CallDetails
        room={call.room}
        title={t("call_popups.incoming_title")}
        meta={t("call_popups.incoming_from", { name: callerName })}
      />
      <div className={styles.actions}>
        <Button
          kind="secondary"
          size="sm"
          onClick={onDecline}
          disabled={declining}
        >
          {t("action.decline")}
        </Button>
        <Button kind="primary" size="sm" onClick={goToRoom}>
          {t("action.answer")}
        </Button>
      </div>
    </section>
  );
};

export const CallPopups: FC<Props> = ({ client, currentCalls }) => {
  const { t } = useTranslation();
  const incomingCalls = useIncomingCallNotifications(client);
  const [dismissedCurrentRoomIds, setDismissedCurrentRoomIds] = useState<
    Set<string>
  >(new Set());
  const [dismissedIncomingEventIds, setDismissedIncomingEventIds] = useState<
    Set<string>
  >(new Set());

  const visibleIncomingCalls = incomingCalls.filter(
    (call) => !dismissedIncomingEventIds.has(call.eventId),
  );
  const incomingRoomIds = useMemo(
    () => new Set(visibleIncomingCalls.map((call) => call.room.roomId)),
    [visibleIncomingCalls],
  );
  const visibleCurrentCalls = currentCalls.filter(
    (call) =>
      !incomingRoomIds.has(call.room.roomId) &&
      !dismissedCurrentRoomIds.has(call.room.roomId),
  );

  const dismissCurrentCall = useCallback((roomId: string) => {
    setDismissedCurrentRoomIds((roomIds) => new Set(roomIds).add(roomId));
  }, []);
  const dismissIncomingCall = useCallback((eventId: string) => {
    setDismissedIncomingEventIds((eventIds) => new Set(eventIds).add(eventId));
  }, []);

  if (visibleIncomingCalls.length === 0 && visibleCurrentCalls.length === 0) {
    return null;
  }

  return (
    <aside className={styles.stack} aria-label={t("call_popups.label")}>
      {visibleIncomingCalls.map((call) => (
        <IncomingCallCard
          key={call.eventId}
          call={call}
          client={client}
          onDismiss={dismissIncomingCall}
        />
      ))}
      {visibleCurrentCalls.map((call) => (
        <CurrentCallCard
          key={call.room.roomId}
          call={call}
          onDismiss={dismissCurrentCall}
        />
      ))}
    </aside>
  );
};
