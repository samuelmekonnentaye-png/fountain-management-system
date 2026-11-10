// Pure rule: may this account sign in? Returns null when yes, otherwise { code, message }.
export function accountBlock(user) {
  const status = user.approvalStatus || 'approved';
  if (status === 'pending') {
    return {
      code: 'ACCOUNT_PENDING',
      message: 'Your account is waiting for approval by the System Admin. You will be able to sign in once it is approved.',
    };
  }
  if (status === 'rejected') {
    return {
      code: 'ACCOUNT_REJECTED',
      message: `Your registration was not approved.${user.rejectionReason ? ` Reason: ${user.rejectionReason}` : ''}`,
    };
  }
  if (user.isActive === false) {
    return { code: 'ACCOUNT_DISABLED', message: 'This account has been deactivated. Contact the system administrator.' };
  }
  return null;
}
