# Media capture — 61 slots

Screenshots and screen videos for the `media_slots` dataset, captured by script on a THROWAWAY E2E slot
(`scripts/e2e-deploy.sh up --image <release image>`), never on :2003 (its admin branding and client projects
must not appear). The fresh slot seeds the Northwind example project, which is the "client site" every editor
shot shows; fixtures are added on top. Results are uploaded to the `sitewright` project on :2003 (media folder
`docs/`) and written into the slot's `image` / `video` / `poster` fields.

Framing: 1440×900 CSS px at deviceScaleFactor 2 (the platform makes the responsive variants); videos are Chrome
screencast frames → Playwright's ffmpeg (VP9 WebM, constant 25 fps), with a poster from the first frame.

## Batch 1 — the editor on Northwind, API fixtures only
| slot | scene | fixtures |
|---|---|---|
| hero_product, feat_editor_code, way_developer, doc_first_site_code | Page editor → Code tab, typing | — |
| way_client, doc_client_editing, doc_inline_editing, feat_templating_click | Content editor as a client | client invite (member) |
| feat_editor_library | Code editor, Library rail open | — |
| feat_templating_entry, doc_datasets_editor, doc_dataset_schema | Datasets panel | team / products |
| feat_components_studio | SVG animation studio | — |
| feat_media_library | File Manager, images/team | — |
| feat_media_audit, feat_seo_audit, doc_editor_tour_audit | Page Audit (Lighthouse on the slot) | — |
| feat_languages_add, feat_languages_coverage, doc_languages | Languages / Translations | add fr |
| feat_forms_editor, doc_form_editor | Forms → edit contact | — |
| doc_editor_tour_layout | Pages tab | one draft, one child page |
| doc_brand_identity, doc_chrome_skeleton, doc_shop_channels | Settings sheets | shop channels |
| doc_storage_backups | System Settings → Ops | — |
| doc_whitelabel_signin, doc_whitelabel_settings, feat_security_branding | Branding, sign-in screen | "Northwind Studio" branding |
| doc_access_keys | Account → Access keys | 2 project tokens + 1 member token |
| feat_hosting_share | Preview share links | 3 shares, one expiring soon |
| agent_mobile, agent_tablet, agent_desktop | preview_page screenshots | — |
| feat_agents_consent, doc_agent_consent | OAuth consent page | a registered client named "Claude Code" |

## Batch 2 — database fixtures (in-container script on the slot)
| slot | fixtures |
|---|---|
| tile_stats, feat_stats_dashboard | 30 days of visits, bots, two goals |
| feat_rank_table, doc_rankings | 8 keywords, 12 weeks, one snippet, one outside the top 100 |
| feat_search_performance | 28 days of Google Search Console rows |
| feat_shop_orders | 6 orders: paid, pending, refunded |
| tile_forms, feat_forms_inbox | submissions through the real `/f/` endpoint, plus filtered ones |
| feat_booking_requests | booking config, one paid request, three upcoming bookings |
| feat_hosting_domains, doc_custom_domains | three domains: verified+primary, pending (TXT), failed |
| feat_publish_targets, doc_deploy_wizard, doc_demo_toggle, feat_publish_progress | local + SFTP (the `dind` test server) + git (deployed before, demo copy) |

## Batch 3 — live-site and composite scenes
| slot | scene |
|---|---|
| feat_shop_checkout | a DEMO COPY of Northwind's shop: add two products, check out, demo thank-you |
| feat_booking_widget, doc_booking_widget | a demo copy's booking widget (sample slots) |
| feat_consent_banner, doc_consent_banner | Northwind with consent on (bar layout), Customize, a held-back YouTube embed |
| way_agent, doc_import_clone | REAL MCP calls against the slot, replayed as a terminal panel beside the editor |
| feat_import_compare | import a small site, nativize, visual_audit pair |
| feat_agents_assistant | needs an AI key on the slot — left as a placeholder unless one is provided |
