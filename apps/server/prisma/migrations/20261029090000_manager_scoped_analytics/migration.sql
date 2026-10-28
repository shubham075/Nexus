-- SOT D18: managers see analytics for their own units (scope comes from where the role is granted).
UPDATE "Role" SET "permissions" = array_append("permissions", 'analytics.view')
WHERE "name" = 'Manager' AND "isSystem" = true AND NOT ('analytics.view' = ANY("permissions"));
