/**
 * Correlated subquery (alias the outer runs table as `r`) for a run's name:
 * the first non-blank line of its note, trimmed. The web app strips Markdown
 * markers and truncates it (`runNoteTitle` in `components/runs/run-title.ts`).
 * Shared by the runs list and the dashboard's recent runs so both name a run
 * the same way.
 */
export const RUN_NOTE_TITLE_SQL = `(
                select nullif(
                    btrim(
                        split_part(
                            btrim(rn.body, chr(32) || chr(9) || chr(10) || chr(13)),
                            chr(10),
                            1
                        ),
                        chr(32) || chr(9) || chr(13)
                    ),
                    ''
                )
                from run_notes rn
                where rn.run_id = r.id
                limit 1
            )`;
