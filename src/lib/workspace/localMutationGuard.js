export function createLocalMutationGuard() {
  const counts = {
    labels: 0,
    labelCatalog: 0,
    archiveRequest: 0,
    comments: 0,
  };

  return {
    begin(target) {
      counts[target] = (counts[target] ?? 0) + 1;
    },
    end(target) {
      counts[target] = Math.max(0, (counts[target] ?? 0) - 1);
    },
    isActive(target) {
      return (counts[target] ?? 0) > 0;
    },
    isAnyActive(targets) {
      return targets.some((target) => this.isActive(target));
    },
  };
}
