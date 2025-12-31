/**
 * Production Monitoring Dashboard
 * Real-time monitoring and alerting interface
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Server, 
  Database, 
  Wifi,
  CreditCard,
  TrendingUp,
  Users,
  Mail,
  Bell,
  RefreshCw
} from 'lucide-react';

interface MonitoringData {
  overview: {
    status: 'healthy' | 'unhealthy' | 'degraded';
    uptime: number;
    version: string;
    totalErrors: number;
    totalAlerts: number;
    activeAlerts: number;
    totalLogs: number;
  };
  health: {
    status: string;
    checks: Array<{
      name: string;
      status: string;
      responseTime: number;
      message?: string;
      lastChecked: string;
    }>;
    summary: {
      healthy: number;
      degraded: number;
      unhealthy: number;
    };
  };
  errors: {
    total: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    recent: Array<{
      timestamp: string;
      category: string;
      severity: string;
      message: string;
      userId?: string;
      walletAddress?: string;
      endpoint?: string;
    }>;
  };
  alerts: {
    total: number;
    active: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    recent: Array<{
      id: string;
      type: string;
      severity: string;
      title: string;
      message: string;
      timestamp: string;
      resolved?: boolean;
      resolvedAt?: string;
    }>;
  };
  performance: {
    responseTime: number;
    memoryUsage: NodeJS.MemoryUsage;
    nodeVersion: string;
    platform: string;
    environment: string;
  };
}

export default function MonitoringDashboard() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchMonitoringData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/monitoring/dashboard');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const monitoringData = await response.json();
      setData(monitoringData);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch monitoring data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMonitoringData();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchMonitoringData, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-600';
      case 'degraded': return 'text-yellow-600';
      case 'unhealthy': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="h-4 w-4" />;
      case 'degraded': return <AlertTriangle className="h-4 w-4" />;
      case 'unhealthy': return <XCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatUptime = (ms: number) => {
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  if (loading && !data) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <RefreshCw className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading monitoring data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Production Monitoring</h1>
          <p className="text-muted-foreground">Real-time system monitoring and alerting</p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="text-sm text-muted-foreground">
            Last updated: {lastRefresh.toLocaleString()}
          </div>
          <Button onClick={fetchMonitoringData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* System Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">System Status</p>
                <div className="flex items-center space-x-2 mt-1">
                  {getStatusIcon(data.overview.status)}
                  <span className={`text-2xl font-bold ${getStatusColor(data.overview.status)}`}>
                    {data.overview.status.toUpperCase()}
                  </span>
                </div>
              </div>
              <Activity className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Uptime</p>
                <p className="text-2xl font-bold">{formatUptime(data.overview.uptime)}</p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Alerts</p>
                <p className="text-2xl font-bold text-red-600">{data.overview.activeAlerts}</p>
              </div>
              <Bell className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Errors</p>
                <p className="text-2xl font-bold text-orange-600">{data.overview.totalErrors}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="health" className="space-y-4">
        <TabsList>
          <TabsTrigger value="health">Health Checks</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        {/* Health Checks Tab */}
        <TabsContent value="health" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Service Health</CardTitle>
              <CardDescription>
                Real-time health status of all critical services
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.health.checks.map((check) => (
                  <div key={check.name} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      {getStatusIcon(check.status)}
                      <div>
                        <h4 className="font-medium">{check.name}</h4>
                        <p className="text-sm text-muted-foreground">
                          Response time: {check.responseTime}ms
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={check.status === 'healthy' ? 'default' : 'destructive'}>
                        {check.status}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(check.lastChecked).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="mt-6 pt-4 border-t">
                <div className="flex justify-around text-center">
                  <div>
                    <p className="text-2xl font-bold text-green-600">{data.health.summary.healthy}</p>
                    <p className="text-sm text-muted-foreground">Healthy</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-yellow-600">{data.health.summary.degraded}</p>
                    <p className="text-sm text-muted-foreground">Degraded</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-600">{data.health.summary.unhealthy}</p>
                    <p className="text-sm text-muted-foreground">Unhealthy</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Alerts Tab */}
        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Alerts</CardTitle>
              <CardDescription>
                Latest system alerts and notifications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.alerts.recent.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-4" />
                    <p>No recent alerts</p>
                  </div>
                ) : (
                  data.alerts.recent.map((alert) => (
                    <div key={alert.id} className="flex items-start justify-between p-4 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <h4 className="font-medium">{alert.title}</h4>
                          <Badge className={getSeverityColor(alert.severity)}>
                            {alert.severity}
                          </Badge>
                          {alert.resolved && (
                            <Badge variant="outline" className="bg-green-100 text-green-800">
                              Resolved
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(alert.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Errors Tab */}
        <TabsContent value="errors" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Errors by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(data.errors.byCategory).map(([category, count]) => (
                    <div key={category} className="flex justify-between">
                      <span className="capitalize">{category}</span>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Errors by Severity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(data.errors.bySeverity).map(([severity, count]) => (
                    <div key={severity} className="flex justify-between">
                      <span className="capitalize">{severity}</span>
                      <Badge className={getSeverityColor(severity)}>{count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent Errors</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {data.errors.recent.slice(0, 10).map((error, index) => (
                  <div key={index} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <Badge className={getSeverityColor(error.severity)}>
                        {error.severity}
                      </Badge>
                      <Badge variant="outline">{error.category}</Badge>
                    </div>
                    <p className="text-sm font-medium">{error.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(error.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>System Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span>Response Time</span>
                    <span className="font-mono">{data.performance.responseTime}ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Node Version</span>
                    <span className="font-mono">{data.performance.nodeVersion}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Platform</span>
                    <span className="font-mono">{data.performance.platform}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Environment</span>
                    <span className="font-mono">{data.performance.environment}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Memory Usage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span>Heap Used</span>
                    <span className="font-mono">
                      {Math.round(data.performance.memoryUsage.heapUsed / 1024 / 1024)}MB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Heap Total</span>
                    <span className="font-mono">
                      {Math.round(data.performance.memoryUsage.heapTotal / 1024 / 1024)}MB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>External</span>
                    <span className="font-mono">
                      {Math.round(data.performance.memoryUsage.external / 1024 / 1024)}MB
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>RSS</span>
                    <span className="font-mono">
                      {Math.round(data.performance.memoryUsage.rss / 1024 / 1024)}MB
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
