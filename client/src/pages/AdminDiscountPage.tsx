import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Plus, BarChart3, Edit, Trash2, Eye } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from '@/lib/queryClient';

interface DiscountCode {
  id: number;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: string;
  currency: string;
  applicableServices: string[];
  usageLimit?: number;
  usedCount: number;
  perUserLimit: number;
  minimumAmount?: number;
  isActive: boolean;
  validFrom?: string;
  validUntil?: string;
  description?: string;
  campaignName?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export default function AdminDiscountPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedCode, setSelectedCode] = useState<DiscountCode | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch discount codes
  const { data: discountData, isLoading } = useQuery({
    queryKey: ['/api/admin/discount-codes/list'],
    retry: false
  });

  // Create discount code mutation
  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/admin/discount-codes/create', 'POST', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/discount-codes/list'] });
      setIsCreateDialogOpen(false);
      toast({
        title: "成功",
        description: "折扣碼創建成功"
      });
    },
    onError: (error: any) => {
      toast({
        title: "創建失敗",
        description: error.message || "創建折扣碼時發生錯誤",
        variant: "destructive"
      });
    }
  });

  // Update discount code mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest(`/api/admin/discount-codes/${id}`, 'PUT', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/discount-codes/list'] });
      toast({
        title: "成功",
        description: "折扣碼更新成功"
      });
    }
  });

  // Delete discount code mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/discount-codes/${id}`, 'DELETE'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/discount-codes/list'] });
      toast({
        title: "成功",
        description: "折扣碼已停用"
      });
    }
  });

  const discountCodes: DiscountCode[] = discountData?.codes || [];

  const formatCurrency = (amount: number, currency: string) => {
    if (currency === 'JPY') return `¥${amount}`;
    if (currency === 'TWD') return `NT$${amount}`;
    return `$${amount}`;
  };

  const CreateDiscountForm = ({ onSubmit, initialData }: any) => {
    const [formData, setFormData] = useState({
      code: '',
      discountType: 'percentage',
      discountValue: '',
      currency: 'ALL',
      applicableServices: ['eccal', 'fabe'],
      usageLimit: '',
      perUserLimit: '1',
      minimumAmount: '',
      validFrom: '',
      validUntil: '',
      description: '',
      campaignName: '',
      isActive: true,
      ...initialData
    });

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const data = {
        ...formData,
        usageLimit: formData.usageLimit ? parseInt(formData.usageLimit) : undefined,
        perUserLimit: parseInt(formData.perUserLimit),
        minimumAmount: formData.minimumAmount ? parseFloat(formData.minimumAmount) : undefined,
        validFrom: formData.validFrom || undefined,
        validUntil: formData.validUntil || undefined
      };
      onSubmit(data);
    };

    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="code">折扣碼</Label>
            <Input
              id="code"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              placeholder="例如：SAVE20"
              required
            />
          </div>
          <div>
            <Label htmlFor="campaignName">活動名稱</Label>
            <Input
              id="campaignName"
              value={formData.campaignName}
              onChange={(e) => setFormData({ ...formData, campaignName: e.target.value })}
              placeholder="例如：新年促銷"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label htmlFor="discountType">折扣類型</Label>
            <Select value={formData.discountType} onValueChange={(value) => setFormData({ ...formData, discountType: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">百分比</SelectItem>
                <SelectItem value="fixed">固定金額</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="discountValue">折扣值</Label>
            <Input
              id="discountValue"
              value={formData.discountValue}
              onChange={(e) => setFormData({ ...formData, discountValue: e.target.value })}
              placeholder={formData.discountType === 'percentage' ? '20' : '100'}
              required
            />
          </div>
          <div>
            <Label htmlFor="currency">貨幣</Label>
            <Select value={formData.currency} onValueChange={(value) => setFormData({ ...formData, currency: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">所有貨幣</SelectItem>
                <SelectItem value="TWD">新台幣</SelectItem>
                <SelectItem value="USD">美元</SelectItem>
                <SelectItem value="JPY">日圓</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>適用服務</Label>
          <div className="flex gap-2 mt-2">
            {['eccal', 'fabe'].map(service => (
              <label key={service} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.applicableServices.includes(service)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFormData({
                        ...formData,
                        applicableServices: [...formData.applicableServices, service]
                      });
                    } else {
                      setFormData({
                        ...formData,
                        applicableServices: formData.applicableServices.filter(s => s !== service)
                      });
                    }
                  }}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">{service}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label htmlFor="usageLimit">總使用次數限制</Label>
            <Input
              id="usageLimit"
              type="number"
              value={formData.usageLimit}
              onChange={(e) => setFormData({ ...formData, usageLimit: e.target.value })}
              placeholder="無限制"
            />
          </div>
          <div>
            <Label htmlFor="perUserLimit">每用戶限制</Label>
            <Input
              id="perUserLimit"
              type="number"
              value={formData.perUserLimit}
              onChange={(e) => setFormData({ ...formData, perUserLimit: e.target.value })}
              required
            />
          </div>
          <div>
            <Label htmlFor="minimumAmount">最低消費金額</Label>
            <Input
              id="minimumAmount"
              type="number"
              step="0.01"
              value={formData.minimumAmount}
              onChange={(e) => setFormData({ ...formData, minimumAmount: e.target.value })}
              placeholder="無限制"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="validFrom">生效時間</Label>
            <Input
              id="validFrom"
              type="datetime-local"
              value={formData.validFrom}
              onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="validUntil">到期時間</Label>
            <Input
              id="validUntil"
              type="datetime-local"
              value={formData.validUntil}
              onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="description">描述</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="折扣碼說明..."
          />
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="isActive"
            checked={formData.isActive}
            onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
          />
          <Label htmlFor="isActive">立即啟用</Label>
        </div>

        <Button type="submit" className="w-full" disabled={createMutation.isPending}>
          {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          創建折扣碼
        </Button>
      </form>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">折扣碼管理</h1>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              新增折扣碼
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>創建新折扣碼</DialogTitle>
            </DialogHeader>
            <CreateDiscountForm onSubmit={(data: any) => createMutation.mutate(data)} />
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="codes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="codes">折扣碼列表</TabsTrigger>
          <TabsTrigger value="analytics">使用統計</TabsTrigger>
        </TabsList>

        <TabsContent value="codes" className="space-y-4">
          <div className="grid gap-4">
            {discountCodes.map((code) => (
              <Card key={code.id}>
                <CardContent className="p-6">
                  <div className="flex justify-between items-start">
                    <div className="space-y-2">
                      <div className="flex items-center space-x-3">
                        <h3 className="text-xl font-semibold">{code.code}</h3>
                        <Badge variant={code.isActive ? "default" : "secondary"}>
                          {code.isActive ? "啟用" : "停用"}
                        </Badge>
                        {code.campaignName && (
                          <Badge variant="outline">{code.campaignName}</Badge>
                        )}
                      </div>
                      
                      <div className="flex items-center space-x-4 text-sm text-gray-600">
                        <span>
                          {code.discountType === 'percentage' 
                            ? `${code.discountValue}% 折扣` 
                            : `${formatCurrency(parseFloat(code.discountValue), code.currency)} 折扣`}
                        </span>
                        <span>•</span>
                        <span>適用: {code.applicableServices.join(', ')}</span>
                        <span>•</span>
                        <span>已使用: {code.usedCount}{code.usageLimit ? `/${code.usageLimit}` : ''}</span>
                      </div>

                      {code.description && (
                        <p className="text-sm text-gray-600">{code.description}</p>
                      )}

                      <div className="flex items-center space-x-4 text-xs text-gray-500">
                        {code.validFrom && (
                          <span>生效: {new Date(code.validFrom).toLocaleDateString()}</span>
                        )}
                        {code.validUntil && (
                          <span>到期: {new Date(code.validUntil).toLocaleDateString()}</span>
                        )}
                        {code.minimumAmount && (
                          <span>最低消費: {formatCurrency(code.minimumAmountDisplay || code.minimumAmount, code.currency)}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex space-x-2">
                      <Button variant="outline" size="sm">
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="sm">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => deleteMutation.mutate(code.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="analytics">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <BarChart3 className="w-5 h-5 mr-2" />
                使用統計
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">統計功能開發中...</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}