"use client";

import { useEffect, useState } from "react";
import { Authenticated, Unauthenticated } from "convex/react";
import { SignInButton, UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { Laptop, Loader2, Plus, Smartphone, Wifi, WifiOff } from "lucide-react";
import { api } from "../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  return (
    <main className="dark min-h-dvh bg-background text-foreground">
      <Authenticated>
        <Dashboard />
      </Authenticated>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
    </main>
  );
}

function SignIn() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5">
      <div className="mb-6 flex items-center gap-3">
        <AppIcon />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Handoff</h1>
          <p className="text-muted-foreground text-sm">Codex control for your Mac.</p>
        </div>
      </div>
      <Card>
        <CardContent className="p-4">
          <SignInButton mode="modal">
            <Button className="h-11 w-full">Continue with Clerk</Button>
          </SignInButton>
        </CardContent>
      </Card>
    </div>
  );
}

function Dashboard() {
  const [pairingOpen, setPairingOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const viewer = useQuery(api.users.getViewer);
  const devices = useQuery(api.devices.listMyDevices);
  const ensureViewer = useMutation(api.users.ensureViewer);
  const createPairingCode = useMutation(api.devices.createPairingCode);
  const revokeDevice = useMutation(api.devices.revokeDevice);
  const [pairingCode, setPairingCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

  useEffect(() => {
    void ensureViewer();
  }, [ensureViewer]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  const isLoading = viewer === undefined || devices === undefined;
  const hasActiveDevice = devices?.some((device) => !device.revokedAt) ?? false;

  async function handleCreatePairingCode() {
    setPairingLoading(true);
    try {
      const result = await createPairingCode();
      setPairingCode(result);
    } finally {
      setPairingLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AppIcon />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">Handoff</h1>
          </div>
        </div>
        <UserButton />
      </header>

      <section className="mt-10">
        {isLoading ? (
          <DeviceListSkeleton />
        ) : devices.length === 0 ? (
          <div className="flex min-h-[55dvh] items-center justify-center">
            <PairDeviceButton
              pairingOpen={pairingOpen}
              setPairingOpen={setPairingOpen}
              pairingCode={pairingCode}
              pairingLoading={pairingLoading}
              onCreate={handleCreatePairingCode}
              onReset={() => setPairingCode(null)}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-muted-foreground">Devices</h2>
              {!hasActiveDevice && (
                <PairDeviceButton
                  compact
                  pairingOpen={pairingOpen}
                  setPairingOpen={setPairingOpen}
                  pairingCode={pairingCode}
                  pairingLoading={pairingLoading}
                  onCreate={handleCreatePairingCode}
                  onReset={() => setPairingCode(null)}
                />
              )}
            </div>
            <div className="space-y-2">
              {devices.map((device) => (
                <Card key={device._id}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Laptop className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{device.name}</p>
                          <DeviceBadge
                            revokedAt={device.revokedAt}
                            lastSeenAt={device.lastSeenAt}
                            now={now}
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {lastSeenLabel(device.lastSeenAt, now)}
                        </p>
                      </div>
                    </div>
                    {!device.revokedAt && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void revokeDevice({ deviceId: device._id })}
                      >
                        Revoke
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function AppIcon() {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-card text-card-foreground">
      <Smartphone className="size-4" />
    </div>
  );
}

function PairDeviceButton({
  compact = false,
  pairingOpen,
  setPairingOpen,
  pairingCode,
  pairingLoading,
  onCreate,
  onReset,
}: {
  compact?: boolean;
  pairingOpen: boolean;
  setPairingOpen: (open: boolean) => void;
  pairingCode: { code: string; expiresAt: number } | null;
  pairingLoading: boolean;
  onCreate: () => Promise<void>;
  onReset: () => void;
}) {
  return (
    <Dialog open={pairingOpen} onOpenChange={setPairingOpen}>
      <DialogTrigger asChild>
        <Button
          className={compact ? "" : "h-11"}
          onClick={() => {
            onReset();
            void onCreate();
          }}
        >
          <Plus />
          Pair new device
        </Button>
      </DialogTrigger>
      <PairingDialog
        pairingCode={pairingCode}
        loading={pairingLoading}
        onRegenerate={onCreate}
      />
    </Dialog>
  );
}

function PairingDialog({
  pairingCode,
  loading,
  onRegenerate,
}: {
  pairingCode: { code: string; expiresAt: number } | null;
  loading: boolean;
  onRegenerate: () => Promise<void>;
}) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "<convex-url>";
  const command = pairingCode
    ? `HANDOFF_CONVEX_URL=${convexUrl} npm run handoff -- bridge pair ${pairingCode.code}`
    : `HANDOFF_CONVEX_URL=${convexUrl} npm run handoff -- bridge pair <code>`;

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Pair a Mac</DialogTitle>
        <DialogDescription>
          This code is temporary. Pairing a new Mac replaces the current active Mac.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Pairing code</Label>
          <div className="border-border bg-muted flex min-h-16 items-center justify-center rounded-lg border border-dashed px-4">
            {loading ? (
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            ) : (
              <span className="font-mono text-3xl font-semibold tracking-widest">
                {pairingCode?.code ?? "---- ----"}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {pairingCode ? `Expires ${formatTime(pairingCode.expiresAt)}.` : "Generating code."}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pair-command">Bridge command</Label>
          <Input id="pair-command" value={command} readOnly className="font-mono text-xs" />
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={loading}
          onClick={() => void onRegenerate()}
        >
          Regenerate code
        </Button>
      </div>
    </DialogContent>
  );
}

function DeviceBadge({
  revokedAt,
  lastSeenAt,
  now,
}: {
  revokedAt?: number;
  lastSeenAt?: number;
  now: number;
}) {
  if (revokedAt) {
    return <Badge variant="destructive">Revoked</Badge>;
  }

  const online = lastSeenAt ? now - lastSeenAt < 30_000 : false;

  return online ? (
    <Badge>
      <Wifi className="mr-1 size-3" />
      Online
    </Badge>
  ) : (
    <Badge variant="secondary">
      <WifiOff className="mr-1 size-3" />
      Offline
    </Badge>
  );
}

function DeviceListSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function lastSeenLabel(value: number | undefined, now: number) {
  if (!value) return "No heartbeat yet";

  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 60) return `Last heartbeat ${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  return `Last heartbeat ${minutes}m ago`;
}
