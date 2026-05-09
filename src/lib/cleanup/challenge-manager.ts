const pendingChallenges = new Map<
  string,
  {
    resolve: (code: string) => void;
    reject: (reason?: unknown) => void;
  }
>();

export function waitForChallengeResponse(runId: string) {
  return new Promise<string>((resolve, reject) => {
    pendingChallenges.set(runId, { resolve, reject });
  });
}

export function resolveChallengeResponse(runId: string, code: string) {
  const challenge = pendingChallenges.get(runId);
  if (!challenge) {
    return false;
  }

  pendingChallenges.delete(runId);
  challenge.resolve(code);
  return true;
}

export function rejectChallengeResponse(runId: string, reason?: unknown) {
  const challenge = pendingChallenges.get(runId);
  if (!challenge) {
    return false;
  }

  pendingChallenges.delete(runId);
  challenge.reject(reason);
  return true;
}
