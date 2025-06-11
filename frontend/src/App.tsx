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
  Spinner
} from '@patternfly/react-core';
import { BuilderImageIcon, CubesIcon, PlayIcon, SyncIcon } from '@patternfly/react-icons';

interface Environment {
  name: string;
  description: string;
  type: string;
  os_version: string;
  base_image: string;
  status: string;
}

interface Build {
  id: string;
  status: string;
  environments: string[];
  started_at: string;
  logs: string[];
}

const App: React.FC = () => {
  const [environments, setEnvironments] = React.useState<Environment[]>([]);
  const [selectedEnvs, setSelectedEnvs] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [isCredentialsModalOpen, setIsCredentialsModalOpen] = React.useState(false);
  const [credentials, setCredentials] = React.useState({
    rh_username: '',
    rh_password: '',
    automation_hub_token: ''
  });
  const [building, setBuilding] = React.useState(false);
  const [buildResult, setBuildResult] = React.useState<{type: 'success' | 'danger', message: string} | null>(null);
  const [currentBuild, setCurrentBuild] = React.useState<Build | null>(null);

  const loadEnvironments = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/environments');
      const data = await response.json();
      setEnvironments(data);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch environments:', err);
      setLoading(false);
    }
  };

  const reloadEnvironments = async () => {
    setLoading(true);
    try {
      await fetch('http://localhost:8000/api/environments/reload', { method: 'POST' });
      await loadEnvironments();
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
          credentials: credentials
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        setBuildResult({ type: 'success', message: `Build started: ${result.build_id}` });
        // Start polling for build status
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
        // Continue polling
        setTimeout(() => pollBuildStatus(buildId), 2000);
      } else {
        // Build finished
        setBuilding(false);
        if (build.status === 'completed') {
          setBuildResult({ type: 'success', message: `✅ Build completed! Built ${build.images.length} images.` });
        } else {
          setBuildResult({ type: 'danger', message: `❌ Build failed. Check logs for details.` });
        }
      }
    } catch (err) {
      console.error('Failed to poll build status:', err);
      setBuilding(false);
    }
  };

  React.useEffect(() => {
    loadEnvironments();
  }, []);

  const handleEnvToggle = (envName: string, checked: boolean) => {
    if (checked) {
      setSelectedEnvs([...selectedEnvs, envName]);
    } else {
      setSelectedEnvs(selectedEnvs.filter(name => name !== envName));
    }
  };

  return (
    <Page>
      {/* Header Section */}
      <PageSection variant="light">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <BuilderImageIcon style={{ marginRight: '12px', color: '#0066cc', fontSize: '2rem' }} />
            <Title headingLevel="h1" size="2xl">
              EE Containers Builder
            </Title>
          </div>
          <Button
            variant="secondary"
            icon={<SyncIcon />}
            onClick={reloadEnvironments}
            isLoading={loading}
          >
            Reload Environments
          </Button>
        </div>
        <Text component="p">
          Build and manage Ansible Execution Environments with ease
        </Text>
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
                <CubesIcon style={{ marginRight: '8px' }} />
                Available Environments ({environments.length})
              </CardTitle>
              <CardBody>
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '40px' }}>
                    <Spinner size="lg" />
                    <Text style={{ marginTop: '16px' }}>Loading environments...</Text>
                  </div>
                ) : (
                  <div>
                    {environments.map((env) => (
                      <div key={env.name} style={{ marginBottom: '16px', padding: '12px', border: '1px solid #d2d2d2', borderRadius: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                          <Checkbox
                            id={env.name}
                            name={env.name}
                            isChecked={selectedEnvs.includes(env.name)}
                            onChange={(event, checked) => handleEnvToggle(env.name, checked)}
                            style={{ marginRight: '12px', marginTop: '4px' }}
                          />
                          <div style={{ flex: 1 }}>
                            <Title headingLevel="h4" size="md" style={{ marginBottom: '8px' }}>
                              {env.name}
                            </Title>
                            <Text component="small" style={{ display: 'block', marginBottom: '8px' }}>
                              {env.description}
                            </Text>
                            <div style={{ marginBottom: '8px' }}>
                              <Label color="blue">{env.type.toUpperCase()}</Label>
                              <Label color="purple" style={{ marginLeft: '8px' }}>
                                {env.os_version.toUpperCase()}
                              </Label>
                              <Label color="grey" style={{ marginLeft: '8px' }}>
                                {env.status.toUpperCase()}
                              </Label>
                            </div>
                            <Text component="small" style={{ fontFamily: 'monospace', fontSize: '11px', color: '#666' }}>
                              {env.base_image}
                            </Text>
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {environments.length === 0 && (
                      <Text>No environments found. Make sure the environments directory exists.</Text>
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
                    <div style={{ fontWeight: 'bold' }}>Build Status: {currentBuild.status.toUpperCase()}</div>
                    <Progress 
                      value={currentBuild.status === 'completed' ? 100 : currentBuild.status === 'running' ? 50 : 25}
                      size={ProgressSize.sm}
                      style={{ marginTop: '8px' }}
                    />
                    <div style={{ marginTop: '8px', maxHeight: '200px', overflow: 'auto', backgroundColor: '#f5f5f5', padding: '8px', borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace' }}>
                      {currentBuild.logs.slice(-10).map((log, index) => (
                        <div key={index}>{log}</div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f0f8ff', borderRadius: '4px' }}>
                  <Text component="small">
                    <strong>API Status:</strong> Connected ✅<br />
                    <strong>Backend:</strong> localhost:8000<br />
                    <strong>Environments:</strong> {environments.length} found
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
    </Page>
  );
};

export default App;
