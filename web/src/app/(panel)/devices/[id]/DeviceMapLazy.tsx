"use client";

import dynamic from "next/dynamic";

export const DeviceMapLazy = dynamic(() => import("./DeviceMap").then((m) => m.DeviceMap), { ssr: false });
