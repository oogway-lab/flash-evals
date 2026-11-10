"use client";

import type {
    IMatrixCellScore,
    IRunAudioTranscriptSummary,
    IRunConfigSnapshot,
    RunStatus,
} from "@flash-evals/api-contract";
import { MatrixView } from "@/components/runs/matrix-view";
import { goldenScoreLabel } from "@/components/runs/golden-score";
import { ModelsTable } from "@/components/runs/models-table";
import type { IModelResult } from "@/components/runs/run-results";
import { RunTranscriptPanel } from "@/components/runs/run-transcript-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
    ModelCol,
    ItemRow,
    CellData,
    SaveCellAnnotationAction,
} from "@/components/runs/types";

/**
 * The models table, then the item-level views (transcripts, matrix) one tab
 * away.
 */
export function RunDetailView({
    results,
    runStatus,
    models,
    items,
    cells,
    scoresByCell,
    audioTranscripts,
    configSnapshot,
    saveCellAnnotationAction,
}: {
    results: IModelResult[];
    runStatus: RunStatus;
    models: ModelCol[];
    items: ItemRow[];
    cells: CellData[];
    scoresByCell: Record<string, IMatrixCellScore[]>;
    audioTranscripts: IRunAudioTranscriptSummary[];
    configSnapshot: IRunConfigSnapshot;
    saveCellAnnotationAction: SaveCellAnnotationAction;
}) {
    return (
        <div>
            <Tabs defaultValue="models">
                <TabsList className="self-start">
                    <TabsTrigger value="models">Models</TabsTrigger>
                    {audioTranscripts.length > 0 && (
                        <TabsTrigger value="transcripts">
                            Transcripts
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="matrix">Matrix</TabsTrigger>
                </TabsList>
                <TabsContent value="models">
                    <ModelsTable
                        results={results}
                        runStatus={runStatus}
                        goldenLabel={goldenScoreLabel(configSnapshot)}
                    />
                </TabsContent>
                {audioTranscripts.length > 0 && (
                    <TabsContent value="transcripts">
                        <RunTranscriptPanel
                            transcripts={audioTranscripts}
                            configSnapshot={configSnapshot}
                        />
                    </TabsContent>
                )}
                <TabsContent value="matrix">
                    <MatrixView
                        models={models}
                        items={items}
                        cells={cells}
                        scoresByCell={scoresByCell}
                        saveCellAnnotationAction={saveCellAnnotationAction}
                        configSnapshot={configSnapshot}
                        stopped={runStatus === "cancelled"}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
