"use client";

import type {
    ILeaderboardRow,
    IMatrixCellScore,
    IRunAudioTranscriptSummary,
    IRunConfigSnapshot,
} from "@mosaic/api-contract";
import { Leaderboard } from "@/components/runs/leaderboard";
import { MatrixView } from "@/components/runs/matrix-view";
import { RunTranscriptPanel } from "@/components/runs/run-transcript-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
    ModelCol,
    ItemRow,
    CellData,
    SaveCellAnnotationAction,
} from "@/components/runs/types";

export function RunDetailView({
    leaderboard,
    models,
    items,
    cells,
    scoresByCell,
    audioTranscripts,
    configSnapshot,
    saveCellAnnotationAction,
}: {
    leaderboard: ILeaderboardRow[];
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
            <Tabs defaultValue="leaderboard">
                <TabsList className="self-start">
                    <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
                    {audioTranscripts.length > 0 && (
                        <TabsTrigger value="transcripts">
                            Transcripts
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="matrix">Matrix</TabsTrigger>
                </TabsList>
                <TabsContent value="leaderboard">
                    <Leaderboard
                        rows={leaderboard}
                        configSnapshot={configSnapshot}
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
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
