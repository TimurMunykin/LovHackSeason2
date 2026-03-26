package com.unical.backend.config;

import com.openai.client.OpenAIClient;
import com.openai.client.okhttp.OpenAIOkHttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;

@Configuration
public class OpenAiConfig {

    @Value("${OPENAI_API_KEY:}")
    private String apiKey;

    @Value("${OPENAI_BASE_URL:}")
    private String baseUrl;

    @Bean
    public OpenAIClient openAIClient() {
        OpenAIOkHttpClient.Builder builder = OpenAIOkHttpClient.builder()
                .apiKey(apiKey);

        if (StringUtils.hasText(baseUrl)) {
            builder.baseUrl(baseUrl);
        }

        return builder.build();
    }
}
