// Pure approval-workflow rules (no database), so they can be unit-tested.
//
//  direct       : the people in "Send To" can decide; the first decision wins.
//  hierarchical : approvals go one by one along the manager chain (Department Head -> Manager -> ...).

export const OPEN_STATUSES = ['submitted', 'in_review'];
export const FINAL_DECISIONS = ['approved', 'returned', 'rejected'];

export const idStr = (x) => String(x?._id ?? x ?? '');

// A report can still receive decisions while it is submitted or in review.
// (A hierarchical report keeps "approved" review entries from earlier approvers while it is still open.)
export const isOpen = (report) => OPEN_STATUSES.includes(report.status);

// Editing rules of a work plan (two phases, reviewed separately).
//  - Planning fields (tasks, targets, weights, dates) can change only while the plan report is draft/returned
//    AND the evaluation has not been sent yet: results must never be judged against moved goals.
//  - Evaluation fields (status, actual, result, reason) can change until the evaluation report is sent,
//    and again if it is returned for correction.
export const isPlanEditable = (planStatus, evalStatus) =>
  ['draft', 'returned'].includes(planStatus) && ['not_started', 'draft'].includes(evalStatus);
export const isEvalEditable = (evalStatus) => ['not_started', 'draft', 'returned'].includes(evalStatus);

export function canDecide(report, userId) {
  if (!OPEN_STATUSES.includes(report.status)) return false;
  const uid = idStr(userId);
  if (report.workflow === 'hierarchical') return idStr(report.currentApproverId) === uid;
  const isTo = report.recipients.some((r) => r.type === 'to' && idStr(r.user) === uid);
  return isTo && !report.reviews.some((r) => FINAL_DECISIONS.includes(r.decision));
}

export function canForward(report, userId) {
  const uid = idStr(userId);
  if (report.workflow === 'hierarchical') return canDecide(report, uid);
  const isTo = report.recipients.some((r) => r.type === 'to' && idStr(r.user) === uid);
  return isTo && !['returned', 'rejected'].includes(report.status);
}

// What happens after an approval?
export function afterApprove(report) {
  if (report.workflow === 'hierarchical') {
    const nextIndex = report.approvalIndex + 1;
    if (nextIndex < report.approvalChain.length) {
      return { final: false, nextIndex, nextApproverId: idStr(report.approvalChain[nextIndex]) };
    }
  }
  return { final: true };
}

export const phaseStatusFor = (decision) =>
  decision === 'approved' ? 'approved' : decision === 'returned' ? 'returned' : 'rejected';

// Forward in a hierarchical report = add that person as the NEXT approver. Returns null if already in the route.
export function insertNextApprover(chain, currentIndex, userId) {
  const ids = chain.map(idStr);
  const uid = idStr(userId);
  if (ids.includes(uid)) return null;
  const copy = [...ids];
  copy.splice(currentIndex + 1, 0, uid);
  return copy;
}

// Walks up the "manager" links. `usersById` is a Map of id -> { manager, isActive }.
// Loops are cut, inactive managers are skipped, depth is limited.
export function walkChain(ownerId, usersById, maxDepth = 8) {
  const ids = [];
  const seen = new Set([idStr(ownerId)]);
  let current = usersById.get(idStr(ownerId));
  for (let i = 0; i < maxDepth && current?.manager; i += 1) {
    const nextId = idStr(current.manager);
    if (seen.has(nextId)) break;
    seen.add(nextId);
    const next = usersById.get(nextId);
    if (!next) break;
    if (next.isActive !== false) ids.push(nextId);
    current = next;
  }
  return ids;
}
