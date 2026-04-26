/*
Copyright 2022-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

/**
 * An error with messages in both English and the user's preferred language.
 * Use this for errors that need to be displayed inline within another
 * component. For errors that could be given their own screen, prefer
 * RichError.
 */
export abstract class TranslatedError extends Error {
  /**
   * The error message in the user's preferred language.
   */
  public abstract readonly translatedMessage: string;
}
