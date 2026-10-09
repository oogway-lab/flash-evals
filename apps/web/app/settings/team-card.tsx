import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

export function TeamCard() {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <CardTitle>Team</CardTitle>
                    <Badge variant="outline">Coming soon</Badge>
                </div>
                <CardDescription>
                    This workspace is private to you. Inviting teammates into it
                    isn&apos;t available yet.
                </CardDescription>
            </CardHeader>
            <CardContent />
        </Card>
    );
}
