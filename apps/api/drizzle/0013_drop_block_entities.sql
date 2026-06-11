-- Block-tree teardown: the `partial` and `pattern` content kinds (pre-composed block
-- subtrees) were removed when the platform went code-first. Drop any orphaned rows so
-- they can't linger forever; they were already unreachable via every API surface.
DELETE FROM `content` WHERE `kind` IN ('partial', 'pattern');
