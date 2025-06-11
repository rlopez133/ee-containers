import React from 'react';
import {
  Page,
  PageSection,
  Title,
  Card,
  CardTitle,
  CardBody,
  Button,
  Text,
  Grid,
  GridItem,
  Label,
  Modal,
  ModalVariant,
  Form,
  FormGroup,
  TextInput,
  ActionGroup,
  Alert,
  Checkbox,
  Progress,
  ProgressSize,
  Spinner,
  Tabs,
  Tab,
  TabTitleText,
  ExpandableSection,
  Badge,
  Split,
  SplitItem,
  Flex,
  FlexItem,
  TextArea,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Divider
} from '@patternfly/react-core';
import { 
  BuilderImageIcon, 
  CubesIcon, 
  PlayIcon, 
  SyncIcon, 
  InfoCircleIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TimesCircleIcon,
  ClockIcon
} from '@patternfly/react-icons';

interface Environment {
  name: string;
  description: string;
  type: string;
  os_version: string;
  variant: string;
  base_image: string;
  status: string;
  python_deps: string[];
  ansible_deps: string[];
  system_deps: string[];
  collections: any[];
  build_args: any;
  last_built?: string;
  file_size_mb?: number;
}

interface EnvironmentDetails {
  environment: Environment;
  execution_environment_yml: any;
  requirements_txt: string[];
  requirements_yml: any;
  bindep_txt: string[];
  files_info: any;
}

interface Build {
  id: string;
  status: string;
  environments: string[];
  started_at: string;
  completed_at?: string;
  logs: string[];
  images: string[];
  errors: string[];
  build_time_seconds?: number;
}

interface EnvironmentStats {
  total_environments: number;
  by_type: Record<string, number>;
  by_os_version: Record<string, number>;
  by_variant: Record<string, number>;
  last_reload: string;
}

const App: React.FC = () => {
  const [environments, setEnvironments] = React.useState<Environment[]>([]);
  const [selectedEnvs, setSelectedEnvs] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [isCredentialsModalOpen, setIsCredentialsModalOpen] = React.useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = React.useState(false);
  const [selectedEnvDetails, setSelectedEnvDetails] = React.useState<EnvironmentDetails | null>(null);
  const [environmentStats, setEnvironmentStats] = React.useState<EnvironmentStats | null>(null);
  const [credentials, setCredentials] = React.useState({
    rh_username: '',
    rh_password: '',
    automation_hub_token: ''
  });
  const [building, setBuilding] = React.useState(false);
  const [buildResult, setBuildResult] = React.useState<{type: 'success' | 'danger' | 'warning', message: string} | null>(null);
  const [currentBuild, setCurrentBuild] = React.useState<Build | null>(null);
  const [activeTab, setActiveTab] = React.useState<string | number>(0);
  const [filterType, setFilterType] = React.useState<string>('all');
  const [filterOS, setFilterOS] = React.useState<string>('all');

  const loadEnvironments = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/environments');
      const data = await response.json();
      setEnvironments(data);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch environments:', err);
      setBuildResult({ type: 'danger', message: 'Failed to load environments. Make sure the backend is running.' });
      setLoading(false);
    }
  };

  const loadEnvironmentStats = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/environments/stats');
      const data = await response.json();
      setEnvironmentStats(data);
    } catch (err) {
      console.error('Failed to fetch environment stats:', err);
    }
  };

  const loadEnvironmentDetails = async (envName: string) => {
    try {
      const response = await fetch(`http://localhost:8000/api/environments/${envName}`);
      const data = await response.json();
      setSelectedEnvDetails(data);
      setIsDetailsModalOpen(true);
    } catch (err) {
      console.error('Failed to fetch environment details:', err);
      setBuildResult({ type: 'danger', message: `Failed to load details for ${envName}` });
    }
  };

  const reloadEnvironments = async () => {
    setLoading(true);
    try {
      await fetch('http://localhost:8000/api/environments/reload', { method: 'POST' });
      await loadEnvironments();
      await loadEnvironmentStats();
      setBuildResult({ type: 'success', message: 'Environments reloaded from disk!' });
    } catch (err) {
      setBuildResult({ type: 'danger', message: 'Failed to reload environments' });
    }
  };

  const startBuild = async () => {
    if (selectedEnvs.length === 0) {
      setBuildResult({ type: 'danger', message: 'Please select at least one environment' });
      return;
    }

    setBuilding(true);
    setBuildResult(null);
    setIsCredentialsModalOpen(false);

    try {
      const response = await fetch('http://localhost:8000/api/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environments: selectedEnvs,
          credentials: credentials,
          build_options: {}
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        setBuildResult({ type: 'success', message: `Build started: ${result.build_id}` });
        pollBuildStatus(result.build_id);
      } else {
        setBuildResult({ type: 'danger', message: result.detail || 'Build failed to start' });
        setBuilding(false);
      }
    } catch (err) {
      setBuildResult({ type: 'danger', message: 'Failed to start build' });
      setBuilding(false);
    }
  };

  const pollBuildStatus = async (buildId: string) => {
    try {
      const response = await fetch(`http://localhost:8000/api/builds/${buildId}`);
      const build = await response.json();
      setCurrentBuild(build);

      if (build.status === 'running' || build.status === 'queued') {
        setTimeout(() => pollBuildStatus(buildId), 2000);
      } else {
        setBuilding(false);
        if (build.status === 'completed') {
          setBuildResult({ 
            type: 'success', 
            message: `✅ Build completed! Built ${build.images.length} images in ${build.build_time_seconds}s.` 
          });
        } else if (build.status === 'completed_with_errors') {
          setBuildResult({ 
            type: 'warning', 
            message: `⚠️ Build completed with ${build.errors.length} errors. Check logs for details.` 
          });
        } else {
          setBuildResult({ 
            type: 'danger', 
            message: `❌ Build failed. Check logs for details.` 
          });
        }
        // Reload environments to update last_built timestamps
        loadEnvironments();
      }
    } catch (err) {
      console.error('Failed to poll build status:', err);
      setBuilding(false);
    }
  };

  React.useEffect(() => {
    loadEnvironments();
    loadEnvironmentStats();
  }, []);

  const handleEnvToggle = (envName: string, checked: boolean) => {
    if (checked) {
      setSelectedEnvs([...selectedEnvs, envName]);
    } else {
      setSelectedEnvs(selectedEnvs.filter(name => name !== envName));
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'available': return <CheckCircleIcon style={{ color: '#3e8635' }} />;
      case 'yaml_error': return <ExclamationTriangleIcon style={{ color: '#f0ab00' }} />;
      default: return <InfoCircleIcon style={{ color: '#2b9af3' }} />;
    }
  };

  const getBuildStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircleIcon style={{ color: '#3e8635' }} />;
      case 'completed_with_errors': return <ExclamationTriangleIcon style={{ color: '#f0ab00' }} />;
      case 'failed': return <TimesCircleIcon style={{ color: '#c9190b' }} />;
      case 'running': return <Spinner size="sm" />;
      default: return <ClockIcon style={{ color: '#6a6e73' }} />;
    }
  };

  const filteredEnvironments = environments.filter(env => {
    if (filterType !== 'all' && env.type !== filterType) return false;
    if (filterOS !== 'all' && env.os_version !== filterOS) return false;
    return true;
  });

  return (
    <Page>
      {/* Header Section */}
      <PageSection variant="light">
        <Split hasGutter>
          <SplitItem>
            <Flex alignItems={{ default: 'alignItemsCenter' }}>
              <FlexItem>
                <BuilderImageIcon style={{ color: '#0066cc', fontSize: '2rem' }} />
              </FlexItem>
              <FlexItem>
                <Title headingLevel="h1" size="2xl">
                  EE Containers Builder
                </Title>
              </FlexItem>
            </Flex>
          </SplitItem>
          <SplitItem isFilled />
          <SplitItem>
            <Button
              variant="secondary"
              icon={<SyncIcon />}
              onClick={reloadEnvironments}
              isLoading={loading}
            >
              Reload Environments
            </Button>
          </SplitItem>
        </Split>
        <Text component="p" style={{ marginTop: '8px' }}>
          Build and manage Ansible Execution Environments with ease
        </Text>
        
        {/* Stats Dashboard */}
        {environmentStats && (
          <Grid hasGutter style={{ marginTop: '16px' }}>
            <GridItem lg={3} md={6}>
              <Card isCompact>
                <CardBody>
                  <Split>
                    <SplitItem>
                      <Text component="small">Total Environments</Text>
                      <Title headingLevel="h3" size="xl">{environmentStats.total_environments}</Title>
                    </SplitItem>
                    <SplitItem isFilled />
                    <SplitItem>
                      <CubesIcon style={{ fontSize: '1.5rem', color: '#0066cc' }} />
                    </SplitItem>
                  </Split>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem lg={3} md={6}>
              <Card isCompact>
                <CardBody>
                  <Text component="small">RHEL 8 / RHEL 9</Text>
                  <Title headingLevel="h3" size="xl">
                    {environmentStats.by_os_version?.rhel8 || 0} / {environmentStats.by_os_version?.rhel9 || 0}
                  </Title>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem lg={3} md={6}>
              <Card isCompact>
                <CardBody>
                  <Text component="small">EE / DE</Text>
                  <Title headingLevel="h3" size="xl">
                    {environmentStats.by_type?.ee || 0} / {environmentStats.by_type?.de || 0}
                  </Title>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem lg={3} md={6}>
              <Card isCompact>
                <CardBody>
                  <Text component="small">Selected</Text>
                  <Title headingLevel="h3" size="xl">{selectedEnvs.length}</Title>
                </CardBody>
              </Card>
            </GridItem>
          </Grid>
        )}
      </PageSection>

      {/* Alert Messages */}
      {buildResult && (
        <PageSection>
          <Alert variant={buildResult.type} title={buildResult.message} />
        </PageSection>
      )}

      {/* Main Content */}
      <PageSection>
        <Grid hasGutter>
          <GridItem lg={8} md={12}>
            <Card>
              <CardTitle>
                <Split>
                  <SplitItem>
                    <Flex alignItems={{ default: 'alignItemsCenter' }}>
                      <FlexItem>
                        <CubesIcon />
                      </FlexItem>
                      <FlexItem>
                        Available Environments ({filteredEnvironments.length})
                      </FlexItem>
                    </Flex>
                  </SplitItem>
                  <SplitItem isFilled />
                  <SplitItem>
                    <Flex>
                      <FlexItem>
                        <select 
                          value={filterType} 
                          onChange={(e) => setFilterType(e.target.value)}
                          style={{ marginRight: '8px', padding: '4px' }}
                        >
                          <option value="all">All Types</option>
                          <option value="ee">EE Only</option>
                          <option value="de">DE Only</option>
                        </select>
                      </FlexItem>
                      <FlexItem>
                        <select 
                          value={filterOS} 
                          onChange={(e) => setFilterOS(e.target.value)}
                          style={{ padding: '4px' }}
                        >
                          <option value="all">All OS</option>
                          <option value="rhel8">RHEL 8</option>
                          <option value="rhel9">RHEL 9</option>
                        </select>
                      </FlexItem>
                    </Flex>
                  </SplitItem>
                </Split>
              </CardTitle>
              <CardBody>
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '40px' }}>
                    <Spinner size="lg" />
                    <Text style={{ marginTop: '16px' }}>Loading environments...</Text>
                  </div>
                ) : (
                  <div>
                    {filteredEnvironments.map((env) => (
                      <div key={env.name} style={{ marginBottom: '16px', padding: '16px', border: '1px solid #d2d2d2', borderRadius: '8px' }}>
                        <Grid hasGutter>
                          <GridItem span={1}>
                            <Checkbox
                              id={env.name}
                              name={env.name}
                              isChecked={selectedEnvs.includes(env.name)}
                              onChange={(event, checked) => handleEnvToggle(env.name, checked)}
                            />
                          </GridItem>
                          <GridItem span={11}>
                            <Split>
                              <SplitItem>
                                <div>
                                  <Flex alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '8px' }}>
                                    <FlexItem>
                                      {getStatusIcon(env.status)}
                                    </FlexItem>
                                    <FlexItem>
                                      <Title headingLevel="h4" size="md">
                                        {env.name}
                                      </Title>
                                    </FlexItem>
                                  </Flex>
                                  <Text component="small" style={{ display: 'block', marginBottom: '8px' }}>
                                    {env.description}
                                  </Text>
                                  <div style={{ marginBottom: '8px' }}>
                                    <Label color="blue">{env.type.toUpperCase()}</Label>
                                    <Label color="purple" style={{ marginLeft: '8px' }}>
                                      {env.os_version.toUpperCase()}
                                    </Label>
                                    <Label color="cyan" style={{ marginLeft: '8px' }}>
                                      {env.variant.toUpperCase()}
                                    </Label>
                                    {env.last_built && (
                                      <Label color="green" style={{ marginLeft: '8px' }}>
                                        Built {new Date(env.last_built).toLocaleDateString()}
                                      </Label>
                                    )}
                                  </div>
                                  <Text component="small" style={{ fontFamily: 'monospace', fontSize: '11px', color: '#666' }}>
                                    {env.base_image}
                                  </Text>
                                  {(env.python_deps.length > 0 || env.ansible_deps.length > 0 || env.system_deps.length > 0) && (
                                    <div style={{ marginTop: '8px' }}>
                                      {env.python_deps.length > 0 && <Badge isRead>{env.python_deps.length} Python</Badge>}
                                      {env.ansible_deps.length > 0 && <Badge isRead style={{ marginLeft: '4px' }}>{env.ansible_deps.length} Ansible</Badge>}
                                      {env.system_deps.length > 0 && <Badge isRead style={{ marginLeft: '4px' }}>{env.system_deps.length} System</Badge>}
                                    </div>
                                  )}
                                </div>
                              </SplitItem>
                              <SplitItem isFilled />
                              <SplitItem>
                                <Button
                                  variant="link"
                                  icon={<InfoCircleIcon />}
                                  onClick={() => loadEnvironmentDetails(env.name)}
                                >
                                  Details
                                </Button>
                              </SplitItem>
                            </Split>
                          </GridItem>
                        </Grid>
                      </div>
                    ))}
                    
                    {filteredEnvironments.length === 0 && (
                      <Text>No environments found matching the current filters.</Text>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          </GridItem>

          <GridItem lg={4} md={12}>
            <Card>
              <CardTitle>Build Control</CardTitle>
              <CardBody>
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontWeight: 'bold' }}>Selected Environments: {selectedEnvs.length}</div>
                  {selectedEnvs.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      {selectedEnvs.map(env => (
                        <Label key={env} color="blue" style={{ marginRight: '4px', marginBottom: '4px' }}>
                          {env}
                        </Label>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  variant="primary"
                  icon={<PlayIcon />}
                  onClick={() => setIsCredentialsModalOpen(true)}
                  isDisabled={selectedEnvs.length === 0 || building}
                  isLoading={building}
                  style={{ marginBottom: '16px', width: '100%' }}
                >
                  {building ? 'Building...' : 'Start Build'}
                </Button>

                {building && currentBuild && (
                  <div style={{ marginTop: '16px' }}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '8px' }}>
                      <FlexItem>
                        {getBuildStatusIcon(currentBuild.status)}
                      </FlexItem>
                      <FlexItem>
                        <div style={{ fontWeight: 'bold' }}>
                          Build Status: {currentBuild.status.toUpperCase().replace('_', ' ')}
                        </div>
                      </FlexItem>
                    </Flex>
                    <Progress 
                      value={currentBuild.status === 'completed' ? 100 : currentBuild.status === 'running' ? 50 : 25}
                      size={ProgressSize.sm}
                      style={{ marginBottom: '8px' }}
                    />
                    <div style={{ maxHeight: '200px', overflow: 'auto', backgroundColor: '#f5f5f5', padding: '8px', borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace' }}>
                      {currentBuild.logs.slice(-10).map((log, index) => (
                        <div key={index}>{log}</div>
                      ))}
                    </div>
                  </div>
                )}

                <Divider style={{ margin: '16px 0' }} />

                <div style={{ padding: '12px', backgroundColor: '#f0f8ff', borderRadius: '4px' }}>
                  <Text component="small">
                    <strong>API Status:</strong> Connected ✅<br />
                    <strong>Backend:</strong> localhost:8000<br />
                    <strong>Environments:</strong> {environments.length} found<br />
                    <strong>Build System:</strong> Ansible Builder
                  </Text>
                </div>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>

      {/* Credentials Modal */}
      <Modal
        variant={ModalVariant.medium}
        title="Red Hat Credentials"
        description="Enter your Red Hat subscription credentials to build execution environments"
        isOpen={isCredentialsModalOpen}
        onClose={() => setIsCredentialsModalOpen(false)}
        actions={[
          <Button key="confirm" variant="primary" onClick={startBuild}>
            Start Build
          </Button>,
          <Button key="cancel" variant="link" onClick={() => setIsCredentialsModalOpen(false)}>
            Cancel
          </Button>
        ]}
      >
        <Form>
          <FormGroup label="Red Hat Username" isRequired fieldId="rh_username">
            <TextInput
              isRequired
              type="text"
              id="rh_username"
              value={credentials.rh_username}
              onChange={(event, value) => setCredentials({...credentials, rh_username: value})}
            />
          </FormGroup>
          <FormGroup label="Red Hat Password" isRequired fieldId="rh_password">
            <TextInput
              isRequired
              type="password"
              id="rh_password"
              value={credentials.rh_password}
              onChange={(event, value) => setCredentials({...credentials, rh_password: value})}
            />
          </FormGroup>
          <FormGroup label="Automation Hub Token" fieldId="automation_hub_token">
            <TextInput
              type="password"
              id="automation_hub_token"
              value={credentials.automation_hub_token}
              onChange={(event, value) => setCredentials({...credentials, automation_hub_token: value})}
            />
          </FormGroup>
        </Form>
      </Modal>

      {/* Environment Details Modal */}
      <Modal
        variant={ModalVariant.large}
        title={selectedEnvDetails ? `Environment Details: ${selectedEnvDetails.environment.name}` : "Environment Details"}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
      >
        {selectedEnvDetails && (
          <Tabs activeKey={activeTab} onSelect={(event, tabIndex) => setActiveTab(tabIndex)}>
            <Tab eventKey={0} title={<TabTitleText>Overview</TabTitleText>}>
              <div style={{ padding: '16px' }}>
                <DescriptionList>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Name</DescriptionListTerm>
                    <DescriptionListDescription>{selectedEnvDetails.environment.name}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Description</DescriptionListTerm>
                    <DescriptionListDescription>{selectedEnvDetails.environment.description}</DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Base Image</DescriptionListTerm>
                    <DescriptionListDescription style={{ fontFamily: 'monospace' }}>
                      {selectedEnvDetails.environment.base_image}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Python Dependencies</DescriptionListTerm>
                    <DescriptionListDescription>
                      {selectedEnvDetails.environment.python_deps.length > 0 ? (
                        selectedEnvDetails.environment.python_deps.join(', ')
                      ) : 'None'}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Ansible Dependencies</DescriptionListTerm>
                    <DescriptionListDescription>
                      {selectedEnvDetails.environment.ansible_deps.length > 0 ? (
                        selectedEnvDetails.environment.ansible_deps.join(', ')
                      ) : 'None'}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>System Dependencies</DescriptionListTerm>
                    <DescriptionListDescription>
                      {selectedEnvDetails.environment.system_deps.length > 0 ? (
                        selectedEnvDetails.environment.system_deps.join(', ')
                      ) : 'None'}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </div>
            </Tab>
            <Tab eventKey={1} title={<TabTitleText>Configuration Files</TabTitleText>}>
              <div style={{ padding: '16px' }}>
                <ExpandableSection toggleText="execution-environment.yml" isExpanded>
                  <TextArea
                    value={JSON.stringify(selectedEnvDetails.execution_environment_yml, null, 2)}
                    rows={10}
                    readOnly
                    style={{ fontFamily: 'monospace', fontSize: '12px' }}
                  />
                </ExpandableSection>
                
                {selectedEnvDetails.requirements_txt.length > 0 && (
                  <ExpandableSection toggleText="requirements.txt">
                    <TextArea
                      value={selectedEnvDetails.requirements_txt.join('\n')}
                      rows={6}
                      readOnly
                      style={{ fontFamily: 'monospace', fontSize: '12px' }}
                    />
                  </ExpandableSection>
                )}
                
                {Object.keys(selectedEnvDetails.requirements_yml).length > 0 && (
                  <ExpandableSection toggleText="requirements.yml">
                    <TextArea
                      value={JSON.stringify(selectedEnvDetails.requirements_yml, null, 2)}
                      rows={6}
                      readOnly
                      style={{ fontFamily: 'monospace', fontSize: '12px' }}
                    />
                  </ExpandableSection>
                )}
                
                {selectedEnvDetails.bindep_txt.length > 0 && (
                  <ExpandableSection toggleText="bindep.txt">
                    <TextArea
                      value={selectedEnvDetails.bindep_txt.join('\n')}
                      rows={6}
                      readOnly
                      style={{ fontFamily: 'monospace', fontSize: '12px' }}
                    />
                  </ExpandableSection>
                )}
              </div>
            </Tab>
          </Tabs>
        )}
      </Modal>
    </Page>
  );
};

export default App;
