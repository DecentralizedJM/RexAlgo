"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { MudrexOrder } from "@/types";

export default function OrdersPage() {
  const [openOrders, setOpenOrders] = useState<MudrexOrder[]>([]);
  const [orderHistory, setOrderHistory] = useState<MudrexOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = useCallback(async () => {
    try {
      const [openRes, historyRes] = await Promise.all([
        fetch("/api/mudrex/orders"),
        fetch("/api/mudrex/orders?history=true"),
      ]);

      if (openRes.ok) {
        const data = await openRes.json();
        setOpenOrders(data.orders || []);
      }
      if (historyRes.ok) {
        const data = await historyRes.json();
        setOrderHistory(data.orders || []);
      }
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  async function handleCancel(orderId: string) {
    try {
      const res = await fetch("/api/mudrex/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", orderId }),
      });

      if (res.ok) {
        toast.success("Order cancelled");
        fetchOrders();
      } else {
        toast.error("Failed to cancel order");
      }
    } catch {
      toast.error("Failed to cancel order");
    }
  }

  function OrderRow({
    order,
    showCancel = false,
  }: {
    order: MudrexOrder;
    showCancel?: boolean;
  }) {
    return (
      <TableRow>
        <TableCell className="font-medium">{order.symbol}</TableCell>
        <TableCell>
          <Badge
            variant="outline"
            className={
              order.order_type === "LONG"
                ? "text-emerald-400 border-emerald-500/20"
                : "text-red-400 border-red-500/20"
            }
          >
            {order.order_type}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge variant="secondary" className="text-xs">
            {order.trigger_type}
          </Badge>
        </TableCell>
        <TableCell className="font-mono text-xs">{order.quantity}</TableCell>
        <TableCell className="font-mono text-xs">
          ${parseFloat(order.price || "0").toFixed(2)}
        </TableCell>
        <TableCell>{order.leverage}x</TableCell>
        <TableCell>
          <Badge
            variant="outline"
            className={
              order.status === "FILLED"
                ? "text-emerald-400 border-emerald-500/20"
                : order.status === "CANCELLED"
                  ? "text-red-400 border-red-500/20"
                  : "text-yellow-400 border-yellow-500/20"
            }
          >
            {order.status}
          </Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {order.created_at
            ? new Date(order.created_at).toLocaleString()
            : "—"}
        </TableCell>
        {showCancel && (
          <TableCell className="text-right">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleCancel(order.order_id)}
            >
              Cancel
            </Button>
          </TableCell>
        )}
      </TableRow>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your futures orders
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchOrders}>
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">
            Open Orders ({openOrders.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            Order History ({orderHistory.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-4">
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle>Open Orders</CardTitle>
              <CardDescription>Orders waiting to be filled</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-12 bg-muted rounded animate-pulse"
                    />
                  ))}
                </div>
              ) : openOrders.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No open orders
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Lev</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {openOrders.map((order) => (
                        <OrderRow
                          key={order.order_id}
                          order={order}
                          showCancel
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle>Order History</CardTitle>
              <CardDescription>
                Past orders (filled, cancelled, expired)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-12 bg-muted rounded animate-pulse"
                    />
                  ))}
                </div>
              ) : orderHistory.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No order history
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Lev</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderHistory.map((order) => (
                        <OrderRow key={order.order_id} order={order} />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
