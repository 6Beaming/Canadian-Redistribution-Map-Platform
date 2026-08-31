export function createLabelMutationQueue() {
  let chain = Promise.resolve();
  let generation = 0;
  let pending = 0;

  return {
    get isBusy() {
      return pending > 0;
    },
    enqueue(task) {
      const taskGeneration = generation;
      pending += 1;
      const run = () => {
        if (taskGeneration !== generation) {
          pending = Math.max(0, pending - 1);
          return Promise.resolve();
        }
        return Promise.resolve(task()).finally(() => {
          pending = Math.max(0, pending - 1);
        });
      };
      const next = chain.then(run, run);
      chain = next.catch(() => {});
      return next;
    },
    flush() {
      generation += 1;
      pending = 0;
      chain = Promise.resolve();
    },
  };
}
