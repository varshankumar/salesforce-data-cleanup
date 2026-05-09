export function hasKernelConfig() {
  return Boolean(process.env.KERNEL_API_KEY);
}

export function getKernelIntegrationNote() {
  if (!hasKernelConfig()) {
    return "Kernel API key not configured. Kernel-backed browser sessions are unavailable.";
  }

  return "Kernel is configured and provides the remote browser session that Playwright connects to over CDP.";
}
