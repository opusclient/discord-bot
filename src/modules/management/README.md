# Team & Role Management

Staff and Development branches, promotion, delegation, account roles and member positions.

**Commands:** /role, /promote, /demote.

**Services:** roleBranchPolicy, roleBranchService, roleOperations, teamManagement, teamRoleHistory, staffNicknames, nicknamePolicy, developmentAccess, accountRoles.

**Gateway events:** guildMemberUpdate, clientReady.

Module commands are declared in index.js and registered through the central module registry. api.js is the stable facade to the domain service implementations under src/services. The staged migration preserves authorization, persisted state and unfinished OAI work.
