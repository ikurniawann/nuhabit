"use client";

import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import type { ComponentProps } from "react";

const ReactApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

type ApexChartProps = {
  type: ComponentProps<typeof ReactApexChart>["type"];
  series: ApexOptions["series"];
  options: ApexOptions;
  height?: number | string;
  width?: number | string;
  className?: string;
};

export function ApexChart({
  type,
  series,
  options,
  height = 320,
  width = "100%",
  className,
}: ApexChartProps) {
  return (
    <div className={className}>
      <ReactApexChart type={type} series={series} options={options} height={height} width={width} />
    </div>
  );
}
