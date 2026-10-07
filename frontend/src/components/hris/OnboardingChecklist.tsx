"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, Clock, User, Calendar, Flag, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/format";
import { ONBOARDING_CATEGORY_LABELS, ONBOARDING_PRIORITY_LABELS } from "@/types/hris";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCompleteOnboardingTask,
  useOnboardingTasks,
  type OnboardingTask,
} from "./use-onboarding-checklist";

interface OnboardingChecklistProps {
  employeeId: string;
  canEdit?: boolean;
  onTaskComplete?: (task: OnboardingTask) => void;
}

export function OnboardingChecklist({
  employeeId,
  canEdit = false,
  onTaskComplete,
}: OnboardingChecklistProps) {
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const tasksQuery = useOnboardingTasks(employeeId, {
    category: filterCategory !== "all" ? filterCategory : undefined,
    completed: filterStatus !== "all" ? filterStatus : undefined,
  });
  const tasks = tasksQuery.data ?? [];
  const isLoading = tasksQuery.isLoading;
  const complete = useCompleteOnboardingTask(employeeId);
  const completingTaskId = complete.isPending ? complete.variables : null;

  const handleCompleteTask = (taskId: string) => {
    complete.mutate(taskId, {
      onSuccess: (result) => {
        toast.success("✅ Task Selesai", { description: "Onboarding task telah diselesaikan" });
        onTaskComplete?.(result.data);
      },
      onError: () => toast.error("Gagal menyelesaikan task."),
    });
  };

  const groupedTasks = tasks.reduce((acc, task) => {
    if (!acc[task.category]) {
      acc[task.category] = [];
    }
    acc[task.category].push(task);
    return acc;
  }, {} as Record<string, OnboardingTask[]>);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.completed).length;
  const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1: return "text-red-600 bg-red-50 border-red-200";
      case 2: return "text-yellow-600 bg-yellow-50 border-yellow-200";
      default: return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-green-600" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Progress Onboarding</CardTitle>
          <CardDescription>
            {completedTasks} dari {totalTasks} task selesai
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Progress value={progressPercentage} className="h-3" />
            <p className="text-sm text-muted-foreground text-right">
              {progressPercentage}%
            </p>
          </div>
          
          {/* Filters */}
          <div className="flex gap-4 mt-4 pt-4 border-t">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kategori</SelectItem>
                {Object.entries(ONBOARDING_CATEGORY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="false">Belum Selesai</SelectItem>
                <SelectItem value="true">Sudah Selesai</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Task Groups by Category */}
      {Object.entries(groupedTasks).map(([category, categoryTasks]) => (
        <Card key={category}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
                  {ONBOARDING_CATEGORY_LABELS[category as keyof typeof ONBOARDING_CATEGORY_LABELS] || category}
                </Badge>
                <span className="text-sm font-normal text-muted-foreground">
                  {categoryTasks.filter(t => t.completed).length}/{categoryTasks.length} selesai
                </span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {categoryTasks.map((task) => (
                <div
                  key={task.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    task.completed
                      ? "bg-green-50 border-green-200"
                      : "bg-white border-gray-200"
                  }`}
                >
                  {/* Checkbox */}
                  {canEdit && !task.completed ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCompleteTask(task.id)}
                      disabled={completingTaskId === task.id}
                      className="shrink-0"
                    >
                      {completingTaskId === task.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : task.completed ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <Circle className="w-4 h-4" />
                      )}
                    </Button>
                  ) : (
                    <div className="shrink-0">
                      {task.completed ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : (
                        <Circle className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  )}

                  {/* Task Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className={`font-medium ${
                          task.completed ? "text-green-800 line-through" : "text-gray-900"
                        }`}>
                          {task.task_name}
                        </h4>
                        {task.description && (
                          <p className="text-sm text-gray-600 mt-1">
                            {task.description}
                          </p>
                        )}
                      </div>
                      
                      {/* Priority Badge */}
                      <Badge
                        variant="outline"
                        className={`shrink-0 ${getPriorityColor(task.priority)}`}
                      >
                        <Flag className="w-3 h-3 mr-1" />
                        {ONBOARDING_PRIORITY_LABELS[task.priority]}
                      </Badge>
                    </div>

                    {/* Meta Info */}
                    <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
                      {task.due_date && (
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          <span>Due: {formatDate(task.due_date)}</span>
                        </div>
                      )}
                      {task.assigned_to && (
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          <span>PIC: {task.assigned_to}</span>
                        </div>
                      )}
                      {task.completed && task.completed_at && (
                        <div className="flex items-center gap-1 text-green-600">
                          <Clock className="w-3 h-3" />
                          <span>Selesai: {formatDate(task.completed_at)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {tasks.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="w-12 h-12 text-gray-300 mb-4" />
            <p className="text-gray-500">Belum ada task onboarding</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
