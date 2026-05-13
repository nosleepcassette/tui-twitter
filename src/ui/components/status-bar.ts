import { Box, Text } from "@opentui/core";
import { theme } from "../theme.js";

export function renderStatusBar(message: string, hints: string) {
  return Box(
    {
      id: "status-bar",
      width: "100%",
      height: 4,
      borderStyle: "single",
      borderColor: theme.border,
      backgroundColor: theme.backgroundMuted,
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    Text({ content: message || "Ready", fg: theme.textMuted }),
    Text({ content: hints, fg: theme.textPrimary }),
  );
}
