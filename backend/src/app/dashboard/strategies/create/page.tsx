import { CreateStrategyForm } from "@/components/dashboard/create-strategy-form";

export default function CreateAlgoStrategyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create Algo Strategy</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Define a rule-based algorithmic trading strategy
        </p>
      </div>
      <CreateStrategyForm
        type="algo"
        redirectPath="/dashboard/strategies"
      />
    </div>
  );
}
