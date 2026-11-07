type NotificationType =
  | "payment_received"
  | "payment_due"
  | "payment_overdue"
  | "maintenance_new"
  | "maintenance_updated"
  | "maintenance_completed"
  | "message_received"
  | "lease_expiring"
  | "tenant_added"
  | "invoice_issued"
  | "tenant_updated"
  | "general"

export type { NotificationType }

export const notificationTemplates = {
  paymentReceived: (tenantName: string, amount: number, propertyName: string) => ({
    type: "payment_received" as NotificationType,
    title: "Payment Received",
    message: `${tenantName} paid $${amount.toLocaleString()} for ${propertyName}`,
  }),

  paymentDue: (tenantName: string, amount: number, dueDate: string) => ({
    type: "payment_due" as NotificationType,
    title: "Payment Due Soon",
    message: `${tenantName}'s rent of $${amount.toLocaleString()} is due on ${dueDate}`,
  }),

  paymentOverdue: (tenantName: string, amount: number, daysLate: number) => ({
    type: "payment_overdue" as NotificationType,
    title: "Payment Overdue",
    message: `${tenantName}'s rent of $${amount.toLocaleString()} is ${daysLate} days overdue`,
  }),

  maintenanceNew: (propertyName: string, title: string, urgency: string) => ({
    type: "maintenance_new" as NotificationType,
    title: "New Maintenance Request",
    message: `${urgency.toUpperCase()}: "${title}" at ${propertyName}`,
  }),

  maintenanceUpdated: (propertyName: string, title: string, status: string) => ({
    type: "maintenance_updated" as NotificationType,
    title: "Maintenance Updated",
    message: `"${title}" at ${propertyName} is now ${status.replace("_", " ")}`,
  }),

  maintenanceCompleted: (propertyName: string, title: string) => ({
    type: "maintenance_completed" as NotificationType,
    title: "Maintenance Completed",
    message: `"${title}" at ${propertyName} has been completed`,
  }),

  messageReceived: (tenantName: string, subject: string) => ({
    type: "message_received" as NotificationType,
    title: "New Message",
    message: `${tenantName} sent you a message: "${subject}"`,
  }),

  leaseExpiring: (tenantName: string, propertyName: string, daysRemaining: number) => ({
    type: "lease_expiring" as NotificationType,
    title: "Lease Expiring Soon",
    message: `${tenantName}'s lease at ${propertyName} expires in ${daysRemaining} days`,
  }),

  tenantAdded: (tenantName: string, propertyName: string) => ({
    type: "tenant_added" as NotificationType,
    title: "New Tenant Added",
    message: `${tenantName} has been added to ${propertyName}`,
  }),

  invoiceIssued: (amount: number, periodLabel: string) => ({
    type: "invoice_issued" as NotificationType,
    title: "New Rent Invoice",
    message: `Your rent invoice of $${amount.toLocaleString()} for ${periodLabel} is ready. Open your portal to pay.`,
  }),

  receiptReady: (amount: number, periodLabel: string) => ({
    type: "payment_received" as NotificationType,
    title: "Payment Received — Receipt Available",
    message: `We received your $${amount.toLocaleString()} payment for ${periodLabel}. Your receipt is available in your portal.`,
  }),

  tenantNewMessage: () => ({
    type: "message_received" as NotificationType,
    title: "New Message",
    message: `You have a new message from your property manager. Open your portal to read and reply.`,
  }),
}
