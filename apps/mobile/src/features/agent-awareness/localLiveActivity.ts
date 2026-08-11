import { Platform } from "react-native";

import { loadPreferences } from "../../persistence/imperative";
import AgentActivity from "../../widgets/AgentActivity";

export function armAgentAwarenessLiveActivityForLocalWork(input: {
  readonly threadTitle: string;
  readonly projectTitle: string;
}): void {
  if (Platform.OS !== "ios") return;

  void loadPreferences()
    .catch(() => null)
    .then((preferences) => {
      if (preferences?.liveActivitiesEnabled === false) return;

      try {
        if (AgentActivity.getInstances().length > 0) return;

        const updatedAt = new Date(Date.now()).toISOString();
        AgentActivity.start({
          title: "T3 Code",
          subtitle: "Agent work in progress",
          activeCount: 1,
          updatedAt,
          activities: [
            {
              environmentId: "",
              threadId: "",
              projectTitle: input.projectTitle,
              threadTitle: input.threadTitle,
              modelTitle: "",
              phase: "starting",
              status: "Connecting",
              updatedAt,
              deepLink: "/",
            },
          ],
        });
      } catch (error) {
        if (__DEV__) console.warn("[agent-awareness] live activity arming failed", error);
      }
    });
}
