"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchSeriesList,
  fetchSeriesDetail,
  type SeriesListItem,
  type SeriesListResult,
  type SeriesDetailResult,
} from "@/api/series";

/**
 * Hook: 获取系列列表
 */
export function useSeriesList(options?: {
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  pageSize?: number;
}) {
  const [series, setSeries] = useState<SeriesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const initializedRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!initializedRef.current) setLoading(true);
    try {
      const data: SeriesListResult = await fetchSeriesList({
        search: options?.search,
        sortBy: options?.sortBy,
        sortOrder: options?.sortOrder,
        page: options?.page,
        pageSize: options?.pageSize,
      });
      setSeries(data.series || []);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      initializedRef.current = true;
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [options?.search, options?.sortBy, options?.sortOrder, options?.page, options?.pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { series, loading, total, totalPages, refetch: fetchData };
}

/**
 * Hook: 获取系列详情
 */
export function useSeriesDetail(seriesName: string | null) {
  const [data, setData] = useState<SeriesDetailResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!seriesName) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await fetchSeriesDetail(seriesName);
      setData(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [seriesName]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, refetch: fetchData };
}
