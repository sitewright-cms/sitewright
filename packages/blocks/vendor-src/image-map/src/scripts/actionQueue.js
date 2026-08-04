let queue = []

export function queueAction(action) {
  let l = queue.length

  queue.unshift(action)

  if (l === 0) {
    runAction()
  }
}

async function runAction() {
  try {
    await queue[queue.length - 1].action()
  } catch {
    // A failed action must not wedge the queue: upstream awaited without a catch, so one
    // rejection left the entry un-popped and every later action queued forever behind it.
  } finally {
    queue.pop()
  }

  if (queue.length > 0) {
    batch()
    runAction()
  }
}

function batch() {
  if (queue.length > 2) {
    let batchedQueue = {}
    for (let action of queue) {
      batchedQueue[action.name] = action
    }

    queue = []
    for (let actionName in batchedQueue) {
      queue.push(batchedQueue[actionName])
    }
  }
}