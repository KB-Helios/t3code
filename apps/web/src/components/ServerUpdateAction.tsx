import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { manualServerUpdateCommand } from "~/versionSkew";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

export function ServerUpdateAction({
  serverLabel,
  targetVersion,
}: {
  readonly serverLabel: string;
  readonly targetVersion: string;
}) {
  const { copyToClipboard } = useCopyToClipboard<{ command: string }>({
    target: "update command",
    onCopy: ({ command }) => {
      toastManager.add({
        type: "success",
        title: "Update command copied",
        description: `Run \`${command}\` on ${serverLabel} to update it.`,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not copy update command",
        description: error.message,
      });
    },
  });
  const command = manualServerUpdateCommand(targetVersion);

  return (
    <Button size="xs" variant="outline" onClick={() => copyToClipboard(command, { command })}>
      Copy update command
    </Button>
  );
}
