import { Box, Text } from "@opentui/core";
import { theme } from "../theme.js";

export function renderHeaderBar(viewTitle: string) {
  return Box(
    {
      id: "header-bar",
      width: "100%",
      height: 3,
      borderStyle: "single",
      borderColor: theme.border,
      backgroundColor: theme.backgroundMuted,
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    Text({ content: "tui-twitter", fg: theme.accentStrong }),
    Text({ content: viewTitle, fg: theme.textPrimary }),
  );
}
