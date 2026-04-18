import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { styles } from '../app/styles';
import { SectionCard } from '../components/common';

export function ConnectionScreen(props: {
  busy: boolean;
  error: string | null;
  baseUrl: string;
  mode: 'admin' | 'person';
  onChangeBaseUrl: (baseUrl: string) => void;
  onChangeMode: (mode: 'admin' | 'person') => void;
  onSubmit: (secret: string) => Promise<void>;
  onClearError: () => void;
}) {
  const [secret, setSecret] = useState('');

  useEffect(() => {
    setSecret('');
  }, [props.mode]);

  return (
    <ScrollView contentContainerStyle={styles.connectionContent} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <Text style={styles.kicker}>PMEOW MOBILE</Text>
        <Text style={styles.title}>连接到 PMEOW 后端</Text>
        <Text style={styles.subtitle}>首次进入先保存后端地址，再选择管理员或普通用户身份接入。</Text>
      </View>

      <SectionCard title="连接配置" description="配置仅保存在本机。">
        <View style={styles.segmentRow}>
          {(['admin', 'person'] as const).map((mode) => {
            const active = props.mode === mode;
            return (
              <Pressable
                key={mode}
                style={[styles.segment, active ? styles.segmentActive : null]}
                onPress={() => {
                  props.onClearError();
                  props.onChangeMode(mode);
                }}
              >
                <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>
                  {mode === 'admin' ? '管理员' : '普通用户'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>后端 URL</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://pmeow.example.com"
          placeholderTextColor="#60758a"
          style={styles.input}
          value={props.baseUrl}
          onChangeText={(value) => {
            props.onClearError();
            props.onChangeBaseUrl(value);
          }}
        />

        <Text style={styles.fieldLabel}>{props.mode === 'admin' ? '管理员密码' : '访问令牌'}</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={props.mode === 'admin' ? '输入管理员密码' : '输入人员访问令牌'}
          placeholderTextColor="#60758a"
          secureTextEntry
          style={styles.input}
          value={secret}
          onChangeText={(value) => {
            props.onClearError();
            setSecret(value);
          }}
        />

        {props.error ? <Text style={styles.errorText}>{props.error}</Text> : null}

        <Pressable
          style={[styles.primaryButton, props.busy ? styles.buttonDisabled : null]}
          disabled={props.busy}
          onPress={() => {
            void props.onSubmit(secret).then(() => setSecret(''));
          }}
        >
          {props.busy ? <ActivityIndicator color="#f3f8fc" /> : <Text style={styles.primaryButtonText}>连接并登录</Text>}
        </Pressable>
      </SectionCard>
    </ScrollView>
  );
}