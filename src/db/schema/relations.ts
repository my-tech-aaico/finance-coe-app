import { relations } from "drizzle-orm";
import { user } from "./auth";
import { entity } from "./entity";
import { claim } from "./claim";
import { department } from "./department";
import { class_ } from "./class";
import { receipt } from "./receipt";

export const claimRelations = relations(claim, ({ one, many }) => ({
  entity: one(entity, { fields: [claim.entityId], references: [entity.id] }),
  claimant: one(user, { fields: [claim.claimantId], references: [user.id], relationName: "claimant" }),
  createdByUser: one(user, { fields: [claim.createdBy], references: [user.id], relationName: "claimCreatedBy" }),
  receipts: many(receipt),
}));

export const receiptRelations = relations(receipt, ({ one }) => ({
  claim: one(claim, { fields: [receipt.claimId], references: [claim.id] }),
  department: one(department, { fields: [receipt.departmentId], references: [department.id] }),
  class_: one(class_, { fields: [receipt.classId], references: [class_.id] }),
  uploadedByUser: one(user, { fields: [receipt.uploadedBy], references: [user.id], relationName: "receiptUploadedBy" }),
  updatedByUser: one(user, { fields: [receipt.updatedBy], references: [user.id], relationName: "receiptUpdatedBy" }),
}));

export const departmentRelations = relations(department, ({ many }) => ({
  receipts: many(receipt),
}));

export const classRelations = relations(class_, ({ many }) => ({
  receipts: many(receipt),
}));

export const entityRelations = relations(entity, ({ many }) => ({
  claims: many(claim),
}));
