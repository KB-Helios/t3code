import { createProviderAuthEnvironmentAtoms } from "@t3tools/client-runtime/state/providerAuth";

import { connectionAtomRuntime } from "../connection/runtime";

export const providerAuth = createProviderAuthEnvironmentAtoms(connectionAtomRuntime);
