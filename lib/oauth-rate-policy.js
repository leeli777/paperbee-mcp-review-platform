export async function consumeHierarchicalLimits(checks) {
  for (const check of checks) {
    if (!(await check())) return false;
  }
  return true;
}
