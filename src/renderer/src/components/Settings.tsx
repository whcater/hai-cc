import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface ClaudeDetectionResult {
  isInstalled: boolean
  version?: string
  path?: string
  error?: string
  timestamp: number
}

interface AIProvider {
  id: string
  name: string
  apiUrl: string
  apiKey: string
}

interface ProxySettings {
  enabled: boolean
  url: string
  username?: string
  password?: string
}

interface ClaudeAccount {
  accountUuid: string
  emailAddress: string
  organizationUuid: string
  organizationRole: string
  workspaceRole: string | null
  organizationName: string
  authorization?: string
}

interface ServiceProvider {
  id: string
  type: 'claude_official' | 'third_party'
  name: string
  accounts: ClaudeAccount[]
  activeAccountId: string
  useProxy: boolean
}

interface SettingsProps {
  claudeDetectionResult: ClaudeDetectionResult | null
  claudeDetecting: boolean
  onRedetectClaude: () => void
  onClose: () => void
}

const Settings: React.FC<SettingsProps> = ({
  claudeDetectionResult,
  claudeDetecting,
  onRedetectClaude,
  onClose
}) => {
  const { t, i18n } = useTranslation()
  const [aiProviders, setAiProviders] = useState<AIProvider[]>([])
  const [proxySettings, setProxySettings] = useState<ProxySettings>({
    enabled: false,
    url: 'http://127.0.0.1:1087'
  })
  const [serviceProviders, setServiceProviders] = useState<ServiceProvider[]>([])
  const [detectingAuth, setDetectingAuth] = useState<Record<string, boolean>>({})
  const [skipPermissions, setSkipPermissions] = useState<boolean>(true)
  const [activeTab, setActiveTab] = useState<'general' | 'accounts' | 'providers' | 'proxy' | 'language' | 'import-export'>('general')
  const [importing, setImporting] = useState<boolean>(false)
  const [exporting, setExporting] = useState<boolean>(false)
  const [includeSensitiveData, setIncludeSensitiveData] = useState<boolean>(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const settings = await window.api.getSettings()
      setProxySettings({
        enabled: settings?.proxyConfig?.enabled || false,
        url: settings?.proxyConfig?.url || 'http://127.0.0.1:1087',
        username: settings?.proxyConfig?.auth?.username,
        password: settings?.proxyConfig?.auth?.password
      })
      
      // Load service providers
      const providers = await window.api.getServiceProviders()
      setServiceProviders(providers || [])
      
      // Load terminal settings
      setSkipPermissions(settings?.terminal?.skipPermissions ?? true)
      
      // Convert third-party service providers to AI providers for the UI
      // Only load providers that were created from AI provider settings (have third_party_ prefix)
      const thirdPartyProviders = providers?.filter(p => 
        p.type === 'third_party' && p.id.startsWith('third_party_')
      ) || []
      const aiProvidersFromService = thirdPartyProviders.map(provider => {
        // Get the first account as the provider info
        const account = provider.accounts?.[0]
        return {
          id: account?.id || provider.id.replace('third_party_', ''),
          name: provider.name || account?.name || 'Unnamed Provider',
          apiUrl: account?.baseUrl || '',
          apiKey: account?.apiKey || ''
        }
      })
      
      // Also load legacy apiProviders for backward compatibility
      const legacyProviders = settings?.apiProviders || []
      
      // Combine both sources, preferring service providers
      const combinedProviders = [...aiProvidersFromService]
      legacyProviders.forEach((legacy: any) => {
        if (!combinedProviders.some(p => p.id === legacy.id)) {
          combinedProviders.push(legacy)
        }
      })
      
      setAiProviders(combinedProviders)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  const saveSettings = async () => {
    try {
      // Save proxy settings and terminal settings
      const settingsToSave = {
        proxyConfig: {
          enabled: proxySettings.enabled,
          url: proxySettings.url,
          auth: proxySettings.username || proxySettings.password ? {
            username: proxySettings.username || '',
            password: proxySettings.password || ''
          } : undefined
        },
        terminal: {
          skipPermissions: skipPermissions
        }
      }
      await window.api.updateSettings(settingsToSave)

      // Save AI providers as third-party service providers
      for (const provider of aiProviders) {
        const providerId = `third_party_${provider.id}`
        const account = {
          id: provider.id,
          name: provider.name,
          apiKey: provider.apiKey,
          baseUrl: provider.apiUrl,
          description: `API Provider: ${provider.name}`
        }
        await window.api.addThirdPartyAccount(providerId, account)
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }

  const addAIProvider = () => {
    const newProvider: AIProvider = {
      id: Date.now().toString(),
      name: '',
      apiUrl: '',
      apiKey: ''
    }
    setAiProviders([...aiProviders, newProvider])
  }

  const updateAIProvider = (id: string, field: keyof AIProvider, value: string) => {
    const updatedProviders = aiProviders.map(provider =>
      provider.id === id ? { ...provider, [field]: value } : provider
    )
    setAiProviders(updatedProviders)
  }

  const removeAIProvider = async (id: string) => {
    try {
      // Remove from service providers if it exists there
      const providers = await window.api.getServiceProviders()
      const providerId = `third_party_${id}`
      const existingProvider = providers.find(p => p.id === providerId && p.type === 'third_party')
      if (existingProvider && existingProvider.accounts.length > 0) {
        const account = existingProvider.accounts[0]
        await window.api.removeThirdPartyAccount(providerId, account.id)
      }
      
      // Remove from local state
      const updatedProviders = aiProviders.filter(provider => provider.id !== id)
      setAiProviders(updatedProviders)
    } catch (error) {
      console.error('Failed to remove AI provider:', error)
      // Still remove from local state even if API call fails
      const updatedProviders = aiProviders.filter(provider => provider.id !== id)
      setAiProviders(updatedProviders)
    }
  }

  const updateProxySettings = (field: keyof ProxySettings, value: any) => {
    const updatedSettings = { ...proxySettings, [field]: value }
    setProxySettings(updatedSettings)
  }

  const changeLanguage = (language: string) => {
    i18n.changeLanguage(language)
  }

  const detectAuthorization = async (accountEmail: string) => {
    try {
      setDetectingAuth(prev => ({ ...prev, [accountEmail]: true }))
      console.log(`开始检测账号: ${accountEmail}`)
      
      const result = await window.api.detectClaudeAuthorization(accountEmail)
      console.log('检测结果:', result)
      
      if (result.success) {
        // Reload service providers to get updated authorization
        await loadSettings() // 重新加载所有设置，包括更新的authorization值
        
        // Show success message
        console.log('账号检测成功')
        // You could add a toast notification here instead of console.log
      } else {
        console.error('账号检测失败:', result.error)
        
        // Provide more user-friendly error messages
        let userMessage = t('settings.detectFailed')
        if (result.error?.includes('超时')) {
          userMessage = t('settings.detectTimeout')
        } else if (result.error?.includes('命令失败')) {
          userMessage = t('settings.commandFailed')
        } else if (result.error?.includes('未选择')) {
          userMessage = t('settings.noAccountSelected')
        }
        
        alert(`${userMessage}\n\n详细信息: ${result.error}`)
      }
    } catch (error) {
      console.error('检测账号时出错:', error)
      alert(t('settings.networkError'))
    } finally {
      setDetectingAuth(prev => ({ ...prev, [accountEmail]: false }))
    }
  }

  const handleExportSettings = async () => {
    try {
      setExporting(true)
      const result = await window.api.exportSettings(includeSensitiveData)
      
      if (result.canceled) {
        return // 用户取消了操作
      }
      
      if (result.success) {
        const message = includeSensitiveData 
          ? t('settings.exportSuccessWithSensitive') 
          : t('settings.exportSuccess')
        alert(message)
      } else {
        alert(t('settings.exportFailed') + (result.error ? `: ${result.error}` : ''))
      }
    } catch (error) {
      console.error('导出配置失败:', error)
      alert(t('settings.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  const handleImportSettings = async () => {
    try {
      setImporting(true)
      const result = await window.api.importSettings()
      
      if (result.canceled) {
        return // 用户取消了操作
      }
      
      if (result.success) {
        const importedItems = result.imported?.join(', ') || ''
        alert(t('settings.importSuccess') + (importedItems ? `\n\n${t('settings.importedItems')}: ${importedItems}` : ''))
        // 重新加载设置
        await loadSettings()
      } else {
        alert(t('settings.importFailed') + (result.error ? `: ${result.error}` : ''))
      }
    } catch (error) {
      console.error('导入配置失败:', error)
      alert(t('settings.importFailed'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-[900px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-xl font-semibold">{t('settings.title')}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Tab Navigation */}
          <div className="w-56 bg-gray-900 border-r border-gray-700 p-4">
            <nav className="space-y-2">
              <button
                onClick={() => setActiveTab('general')}
                className={`w-full text-left px-3 py-2 rounded text-sm ${
                  activeTab === 'general' 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                {t('settings.general')}
              </button>
              <button
                onClick={() => setActiveTab('accounts')}
                className={`w-full text-left px-3 py-2 rounded text-sm ${
                  activeTab === 'accounts' 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                {t('settings.accounts')}
              </button>
              <button
                onClick={() => setActiveTab('providers')}
                className={`w-full text-left px-3 py-2 rounded text-sm ${
                  activeTab === 'providers' 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                {t('settings.aiProviders')}
              </button>
              <button
                onClick={() => setActiveTab('proxy')}
                className={`w-full text-left px-3 py-2 rounded text-sm ${
                  activeTab === 'proxy' 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                {t('settings.proxy')}
              </button>
              <button
                onClick={() => setActiveTab('language')}
                className={`w-full text-left px-3 py-2 rounded text-sm ${
                  activeTab === 'language' 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                {t('settings.language')}
              </button>
              <button
                onClick={() => setActiveTab('import-export')}
                className={`w-full text-left px-3 py-2 rounded text-sm ${
                  activeTab === 'import-export' 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                {t('settings.importExport')}
              </button>
            </nav>
          </div>

          {/* Tab Content */}
          <div className="flex-1 p-6 overflow-auto min-h-[500px]">
            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-medium">{t('settings.claudeCliStatus')}</h3>
                    <button
                      onClick={onRedetectClaude}
                      disabled={claudeDetecting}
                      className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded transition-colors"
                    >
                      {claudeDetecting ? t('settings.detecting') : t('settings.reDetect')}
                    </button>
                  </div>
                  
                  {claudeDetectionResult ? (
                    <div className="space-y-3">
                      <div className={`text-sm flex items-center gap-2 ${claudeDetectionResult.isInstalled ? 'text-green-400' : 'text-red-400'}`}>
                        <span>{claudeDetectionResult.isInstalled ? '✓' : '✗'}</span>
                        <span>
                          {claudeDetectionResult.isInstalled 
                            ? `${t('settings.claudeCliInstalled')} ${claudeDetectionResult.version ? `(${claudeDetectionResult.version})` : ''}`
                            : t('settings.claudeCliNotFound')
                          }
                        </span>
                      </div>
                      
                      {claudeDetectionResult.path && (
                        <div className="text-sm text-gray-400">
                          {t('settings.path')}: {claudeDetectionResult.path}
                        </div>
                      )}
                      
                      {claudeDetectionResult.error && (
                        <div className="text-sm text-red-400">
                          {t('settings.error')}: {claudeDetectionResult.error}
                        </div>
                      )}
                      
                      <div className="text-sm text-gray-500">
                        {t('settings.lastChecked')}: {new Date(claudeDetectionResult.timestamp).toLocaleString()}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-400">
                      {claudeDetecting ? t('settings.detectingClaude') : t('settings.detectionStatusUnknown')}
                    </div>
                  )}
                  
                  {!claudeDetectionResult?.isInstalled && (
                    <>
                      <p className="text-sm text-gray-400 mt-3 mb-2">
                        {t('settings.claudeRequired')}
                      </p>
                      <code className="block bg-gray-900 p-3 rounded text-sm text-green-400">
                        npm install -g @anthropic-ai/claude-code
                      </code>
                    </>
                  )}
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-3">{t('settings.terminalSettings')}</h3>
                  <div className="space-y-4">
                    <div className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        id="skip-permissions"
                        checked={skipPermissions}
                        onChange={(e) => setSkipPermissions(e.target.checked)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <label htmlFor="skip-permissions" className="text-sm font-medium cursor-pointer">
                          {t('settings.skipPermissions')}
                        </label>
                        <p className="text-xs text-gray-400 mt-1">
                          {t('settings.skipPermissionsDesc')}
                        </p>
                        <div className="mt-2 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded text-sm">
                          <p className="text-yellow-300 font-medium">
                            {t('settings.skipPermissionsWarning')}
                          </p>
                          <p className="text-yellow-200 mt-1">
                            {t('settings.skipPermissionsWarningDesc')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-3">{t('settings.projectManagement')}</h3>
                  <p className="text-sm text-gray-400">
                    {t('settings.projectManagementDesc')}
                  </p>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-3">{t('settings.keyboardShortcuts')}</h3>
                  <div className="text-sm text-gray-400 space-y-1">
                    <div>{t('settings.copyShortcut')}</div>
                    <div>{t('settings.pasteShortcut')}</div>
                    <div>{t('settings.clearShortcut')}</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'accounts' && (
              <div className="space-y-6">
                <h3 className="text-lg font-medium">{t('settings.claudeOfficialAccounts')}</h3>
                
                {serviceProviders
                  .filter(provider => provider.type === 'claude_official')
                  .map(provider => (
                    <div key={provider.id} className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-blue-400">{provider.name}</h4>
                        <span className="text-sm text-gray-400">
                          {t('settings.accountsCount', { count: provider.accounts.length, s: provider.accounts.length !== 1 ? 's' : '' })}
                        </span>
                      </div>
                      
                      {provider.accounts.length === 0 ? (
                        <div className="text-center py-8 text-gray-400">
                          <p>{t('settings.noClaudeAccounts')}</p>
                          <p className="text-sm mt-1">{t('settings.pleaseLoginFirst')}</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {provider.accounts.map((account) => (
                            <div key={account.accountUuid} className="bg-gray-700 p-4 rounded-lg">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-3">
                                    <h5 className="font-medium">{account.emailAddress}</h5>
                                    <div className="flex items-center gap-2">
                                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                        account.authorization 
                                          ? 'bg-green-100 text-green-800' 
                                          : 'bg-red-100 text-red-800'
                                      }`}>
                                        {account.authorization ? t('settings.accountAvailable') : t('settings.needDetection')}
                                      </span>
                                    </div>
                                  </div>
                                  
                                  <div className="mt-2 space-y-1 text-sm text-gray-300">
                                    <div>{t('settings.organization')}: {account.organizationName}</div>
                                    <div>{t('settings.role')}: {account.organizationRole}</div>
                                    {account.workspaceRole && (
                                      <div>{t('settings.workspaceRole')}: {account.workspaceRole}</div>
                                    )}
                                  </div>
                                  
                                  {account.authorization && (
                                    <div className="mt-2 text-xs text-green-400">
                                      {t('settings.accountVerified')}
                                    </div>
                                  )}
                                </div>
                                
                                <div className="ml-4">
                                  <button
                                    onClick={() => detectAuthorization(account.emailAddress)}
                                    disabled={detectingAuth[account.emailAddress]}
                                    className={`px-3 py-2 text-sm rounded transition-colors ${
                                      account.authorization
                                        ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600'
                                        : 'bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600'
                                    }`}
                                  >
                                    {detectingAuth[account.emailAddress] 
                                      ? t('settings.detecting')
                                      : account.authorization 
                                        ? t('settings.reDetect')
                                        : t('settings.detectAccount')
                                    }
                                  </button>
                                </div>
                              </div>
                              
                              {!account.authorization && (
                                <div className="mt-3 p-3 bg-yellow-900/30 border border-yellow-700/50 rounded text-sm text-yellow-300">
                                  <p className="font-medium">{t('settings.accountDetectionRequired')}</p>
                                  <p className="mt-1">
                                    {t('settings.accountDetectionDesc')}
                                  </p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                }
                
                {serviceProviders.filter(p => p.type === 'claude_official').length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    <p>{t('settings.noClaudeOfficialAccounts')}</p>
                    <p className="text-sm mt-1">{t('settings.pleaseLoginFirst')}</p>
                  </div>
                )}
                
                <div className="mt-6 p-4 bg-blue-900/30 border border-blue-700/50 rounded">
                  <h4 className="font-medium text-blue-300 mb-2">{t('settings.howToAddAccounts')}</h4>
                  <ol className="text-sm text-blue-200 space-y-1 list-decimal list-inside">
                    <li>{t('settings.openTerminalRun')} <code className="bg-gray-800 px-1 rounded">claude login</code></li>
                    <li>{t('settings.completeLoginBrowser')}</li>
                    <li>{t('settings.restartApplication')}</li>
                    <li>{t('settings.clickDetectAccount')}</li>
                  </ol>
                </div>
              </div>
            )}

            {activeTab === 'providers' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium">{t('settings.aiProvidersTitle')}</h3>
                  <button
                    onClick={addAIProvider}
                    className="px-3 py-2 bg-green-600 hover:bg-green-700 rounded text-sm transition-colors"
                  >
                    {t('settings.addProvider')}
                  </button>
                </div>
                
                <div className="space-y-4">
                  {aiProviders.map((provider) => (
                    <div key={provider.id} className="bg-gray-700 p-4 rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium">{t('settings.providerConfiguration')}</h4>
                        <button
                          onClick={() => removeAIProvider(provider.id)}
                          className="text-red-400 hover:text-red-300 text-sm"
                        >
                          {t('settings.remove')}
                        </button>
                      </div>
                      
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium mb-1">{t('settings.name')}</label>
                          <input
                            type="text"
                            value={provider.name}
                            onChange={(e) => updateAIProvider(provider.id, 'name', e.target.value)}
                            placeholder={t('settings.nameExample')}
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium mb-1">{t('settings.apiUrl')}</label>
                          <input
                            type="url"
                            value={provider.apiUrl}
                            onChange={(e) => updateAIProvider(provider.id, 'apiUrl', e.target.value)}
                            placeholder="https://api.anthropic.com"
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium mb-1">{t('settings.apiKey')}</label>
                          <input
                            type="password"
                            value={provider.apiKey}
                            onChange={(e) => updateAIProvider(provider.id, 'apiKey', e.target.value)}
                            placeholder={t('settings.apiKeyPlaceholder')}
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {aiProviders.length === 0 && (
                    <div className="text-center py-8 text-gray-400">
                      <p>{t('settings.noAiProviders')}</p>
                      <p className="text-sm mt-1">{t('settings.clickAddProvider')}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'proxy' && (
              <div className="space-y-6">
                <h3 className="text-lg font-medium">{t('settings.upstreamProxySettings')}</h3>
                
                <div className="space-y-4">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="proxy-enabled"
                      checked={proxySettings.enabled}
                      onChange={(e) => updateProxySettings('enabled', e.target.checked)}
                      className="mr-2"
                    />
                    <label htmlFor="proxy-enabled" className="text-sm font-medium">
                      {t('settings.enableProxy')}
                    </label>
                  </div>
                  
                  {proxySettings.enabled && (
                    <div className="space-y-4 pl-6 border-l border-gray-600">
                      <div>
                        <label className="block text-sm font-medium mb-1">{t('settings.proxyUrl')}</label>
                        <input
                          type="text"
                          value={proxySettings.url}
                          onChange={(e) => updateProxySettings('url', e.target.value)}
                          placeholder="http://127.0.0.1:1087"
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          {t('settings.proxyUrlExample')}
                        </p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">{t('settings.usernameOptional')}</label>
                          <input
                            type="text"
                            value={proxySettings.username || ''}
                            onChange={(e) => updateProxySettings('username', e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium mb-1">{t('settings.passwordOptional')}</label>
                          <input
                            type="password"
                            value={proxySettings.password || ''}
                            onChange={(e) => updateProxySettings('password', e.target.value)}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                      
                      <div className="text-sm text-gray-400">
                        <p>{t('settings.finalProxyUrl', { url: proxySettings.url, auth: proxySettings.username ? t('settings.withAuthentication') : '' })}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'language' && (
              <div className="space-y-6">
                <h3 className="text-lg font-medium">{t('settings.languageSettings')}</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-3">{t('settings.interfaceLanguage')}</label>
                    <div className="space-y-2">
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="language"
                          value="en"
                          checked={i18n.language === 'en'}
                          onChange={(e) => changeLanguage(e.target.value)}
                          className="mr-3"
                        />
                        <span>{t('settings.english')}</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="radio"
                          name="language"
                          value="zh-CN"
                          checked={i18n.language === 'zh-CN'}
                          onChange={(e) => changeLanguage(e.target.value)}
                          className="mr-3"
                        />
                        <span>{t('settings.simplifiedChinese')}</span>
                      </label>
                    </div>
                  </div>
                  
                  <div className="mt-6 p-4 bg-blue-900/30 border border-blue-700/50 rounded">
                    <h4 className="font-medium text-blue-300 mb-2">{t('settings.languageNote')}</h4>
                    <p className="text-sm text-blue-200">
                      {t('settings.languageNoteDesc')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'import-export' && (
              <div className="space-y-6">
                <h3 className="text-lg font-medium">{t('settings.importExportSettings')}</h3>
                
                <div className="space-y-6">
                  <div className="bg-gray-700 p-6 rounded-lg">
                    <h4 className="text-lg font-medium mb-4">{t('settings.exportConfiguration')}</h4>
                    <p className="text-sm text-gray-300 mb-4">
                      {t('settings.exportDescription')}
                    </p>
                    
                    <div className="mb-4">
                      <label className="flex items-start space-x-3">
                        <input
                          type="checkbox"
                          checked={includeSensitiveData}
                          onChange={(e) => setIncludeSensitiveData(e.target.checked)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium">{t('settings.includeSensitiveData')}</span>
                          <p className="text-xs text-gray-400 mt-1">
                            {t('settings.includeSensitiveDataDesc')}
                          </p>
                        </div>
                      </label>
                      
                      {includeSensitiveData && (
                        <div className="mt-3 p-3 bg-red-900/30 border border-red-700/50 rounded">
                          <p className="text-red-300 text-sm font-medium">
                            {t('settings.sensitiveDataWarning')}
                          </p>
                          <p className="text-red-200 text-xs mt-1">
                            {t('settings.sensitiveDataWarningDesc')}
                          </p>
                        </div>
                      )}
                    </div>
                    
                    <button
                      onClick={handleExportSettings}
                      disabled={exporting}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded transition-colors"
                    >
                      {exporting ? t('settings.exporting') : t('settings.exportSettings')}
                    </button>
                  </div>
                  
                  <div className="bg-gray-700 p-6 rounded-lg">
                    <h4 className="text-lg font-medium mb-4">{t('settings.importConfiguration')}</h4>
                    <p className="text-sm text-gray-300 mb-4">
                      {t('settings.importDescription')}
                    </p>
                    <button
                      onClick={handleImportSettings}
                      disabled={importing}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded transition-colors"
                    >
                      {importing ? t('settings.importing') : t('settings.importSettings')}
                    </button>
                  </div>
                  
                  <div className="p-4 bg-yellow-900/30 border border-yellow-700/50 rounded">
                    <h4 className="font-medium text-yellow-300 mb-2">{t('settings.importExportNote')}</h4>
                    <ul className="text-sm text-yellow-200 space-y-1 list-disc list-inside">
                      <li>{t('settings.exportIncludesProxy')}</li>
                      <li>{t('settings.exportIncludesTerminal')}</li>
                      <li>{t('settings.exportIncludesProjectFilter')}</li>
                      <li>{t('settings.exportIncludesAccounts')}</li>
                      <li>{t('settings.sensitiveDataOptional')}</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-gray-700 flex justify-between">
          <div className="flex gap-3">
            <button
              onClick={handleImportSettings}
              disabled={importing}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded transition-colors"
            >
              {importing ? t('settings.importing') : t('settings.importSettings')}
            </button>
            <button
              onClick={handleExportSettings}
              disabled={exporting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded transition-colors"
            >
              {exporting ? t('settings.exporting') : t('settings.exportSettings')}
            </button>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
            >
              {t('settings.cancel')}
            </button>
            <button
              onClick={async () => {
                // Save all settings before closing
                await saveSettings()
                onClose()
              }}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded transition-colors"
            >
              {t('settings.saveAndClose')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Settings