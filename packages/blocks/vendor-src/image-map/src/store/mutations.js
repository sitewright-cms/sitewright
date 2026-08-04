// Mutations are committed by store.commit(name, payload) and notify mutationSubscribers.
// Upstream shipped only a placeholder here — nothing in the runtime commits a mutation; state is
// written through the store directly. Kept as the extension point commit() looks up.
export default {}
